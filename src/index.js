const TelegramBot = require('node-telegram-bot-api')
const mongoose = require('mongoose')
const geolib = require('geolib')
const _ = require('lodash')
const {debug, logStart, getChatId, getItemUuid} = require('./helpers')
const config = require('./config')
const kb = require('./keyboard_buttons')
const keyboard = require('./keyboard')
const database = require('../database.json')

logStart('message', msg => {
    console.log('Working ')
})

mongoose.connect(config.DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err))

require('./models/film.model')
require('./models/cinema.model')
require('./models/user.model')

const Film = mongoose.model('films')
const Cinema = mongoose.model('cinemas')
const User = mongoose.model('users')
//database.cinemas.forEach(f => new Cinema(f).save())

const ACTION_TYPE = {
    TOGGLE_FAV_FILM: 'tff',
    SHOW_CINEMAS: 'sc',
    SHOW_CINEMAS_MAP: 'scm',
    SHOW_FILMS: 'sf'
}

const bot = new TelegramBot(config.TOKEN, {
    polling: true
})

bot.on('message', msg => {
    const chatId = getChatId(msg)

    switch (msg.text) {
        case kb.home.favorite:
            showFavouriteFilms(chatId, msg.from.id)
            break
        case kb.home.cinemas:
            bot.sendMessage(chatId, 'Отправить местоположение', {
                reply_markup: {
                    keyboard: keyboard.cinemas
                }
            })
            break
        case kb.home.films:
            bot.sendMessage(chatId, 'Виберите жанр:', {
                reply_markup: {keyboard: keyboard.films}
            })
            break
        case kb.film.comedy:
            sendFilmsByQuery(chatId, {type: 'comedy'})
            break
        case kb.film.action:
            sendFilmsByQuery(chatId, {type: 'action'})
            break
        case kb.film.random:
            sendFilmsByQuery(chatId, {})
            break
        case kb.back:
            bot.sendMessage(chatId, 'Что хотите посмотреть?', {
                reply_markup: {keyboard: keyboard.home}
            })
            break
    }

    if(msg.location) {
        getCinemasInCoords(chatId, msg.location)
    }
})

bot.onText(/\/start/, msg => {
    const {id} = msg.chat
    const text = `Здраствуйтеб ${msg.from.first_name}\nВыбирете команду для начала`
    bot.sendMessage(getChatId(msg), text, {
        reply_markup: {
            keyboard: keyboard.home
        }
    })
})

bot.onText(/\/f(.+)/, (msg, [source, match]) => {
    const filmUuid = getItemUuid(source)
    const chatId = getChatId(msg)
    Promise.all([
        Film.findOne({uuid: filmUuid}),
        User.findOne({telegramId: msg.from.id})
    ]).then(([film, user]) => {
        let isFav = false
        if (user) {
            isFav = user.films.indexOf(film.uuid) !== -1
        }
        const favText = isFav ? 'Удалить из избранного' : 'Добавить в избраное'
        const caption = `Название: ${film.name}\nГод: ${film.year}\nРейтинг: ${film.rate}\nДлительность: ${film.length}\nСтрана: ${film.country}`
        bot.sendPhoto(chatId, film.picture, {
            caption: caption,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: favText,
                            callback_data: JSON.stringify({
                                type: ACTION_TYPE.TOGGLE_FAV_FILM,
                                filmUuid: film.uuid,
                                isFav: isFav
                            })
                        },
                        {
                            text: 'Показать кинотеатры',
                            callback_data: JSON.stringify({
                                type: ACTION_TYPE.SHOW_CINEMAS,
                                cinemaUuid: film.cinemas
                            })
                        }
                    ],
                    [
                        {
                            text: `Кинопоиск ${film.name}`,
                            url: film.link
                        }
                    ]
                ]
            }
        })
    })
})

bot.onText(/\/c(.+)/, (msg, [source, match]) => {
    const cinemaUuid = getItemUuid(source)
    const chatId = getChatId(msg)
    Cinema.findOne({uuid: cinemaUuid}).then(cinema => {
        bot.sendMessage(chatId, `Кинотеатр ${cinema.name}`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: cinema.name,
                            url: cinema.url
                        },
                        {
                            text: 'Показать на карте',
                            callback_data: JSON.stringify({
                                type: ACTION_TYPE.SHOW_CINEMAS_MAP,
                                lat: cinema.location.latitude,
                                lon: cinema.location.longitude
                            })
                        }
                    ],
                    [
                        {
                            text: 'Показать фильмы',
                            callback_data: JSON.stringify({
                                type: ACTION_TYPE.SHOW_FILMS,
                                filmsUuid: cinema.films
                            })
                        }
                    ]
                ]
            }
        })
    })
})

bot.on('callback_query', query => {
    let data
    const userId = query.from.id
    try {
        data = JSON.parse(query.data)
    } catch (e) {
        throw new Error('Data is not an object')
    }

    const {type} = data

    if (type === ACTION_TYPE.SHOW_CINEMAS_MAP){
        const {lat, lon} = data
        bot.sendLocation(query.message.chat.id, lat, lon)
    } else if( type === ACTION_TYPE.SHOW_CINEMAS) {
        sendCinemasByQuery(userId, {uuid: {'$in': data.cinemaUuid}})
    } else if (type === ACTION_TYPE.TOGGLE_FAV_FILM) {
        console.log('1')
        toggleFavouriteFilm(userId, query.id, data)
    } else if (type === ACTION_TYPE.SHOW_FILMS) {
        sendFilmsByQuery(userId, {uuid: {'$in': data.filmsUuid}})
    }

})

bot.on('inline_query', query => {
    Film.find({}).then(films => {
        const results = films.map(f => {
            const caption = `Название: ${f.name}\nГод: ${f.year}\nРейтинг: ${f.rate}\nДлительность: ${f.length}\nСтрана: ${f.country}`
            return {
                id: f.uuid,
                type: 'photo',
                photo_url: f.picture,
                thumb_url: f.picture,
                caption: caption,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: `Кинопоиск: ${f.name}`,
                                url: f.link
                            }
                        ]
                    ]
                }
            }
        })

        bot.answerInlineQuery(query.id, results, {
            cache_time: 0
        })
    })
})

function sendFilmsByQuery(chatId, query) {
    Film.find(query)
        .then(films => {
            const html = films.map((f, i) => {
                return `<b>${i + 1}</b> ${f.name} - /${f.uuid}`
            }).join('\n')

            sendHTML(chatId, html, 'films')
        })
}

function sendHTML(chatId, html, kbName = null) {
    const options = {
        parse_mode: 'HTML'
    }

    if (kbName) {
        options['reply_markup'] = {
            keyboard: keyboard[kbName]
        }
    }

    bot.sendMessage(chatId, html, options)
}

function getCinemasInCoords(chatId, location) {
    Cinema.find({}).then(cinemas => {
        cinemas.forEach(c => {
            c.distance = geolib.getDistance(location, c.location) / 1000
        })

        cinemas = _.sortBy(cinemas, 'distance')

        const html = cinemas.map((c, i) => {
            return `<b>${i + 1}</b> ${c.name}. <em>Расстояние</em> - <strong>${c.distance}</strong> км. /${c.uuid}`
        }).join('\n')

        sendHTML(chatId, html, 'home')
    })
}

function toggleFavouriteFilm(userId, queryId, {filmUuid, isFav}) {

    let userPromise

    User.findOne({telegramId: userId})
        .then(user => {
            if (user) {
                if (isFav) {
                    user.films = user.films.filter(fUuid => fUuid !== filmUuid)
                } else {
                    user.films.push(filmUuid)
                }
                userPromise = user
            } else {
                userPromise = new User({
                    telegramId: userId,
                    films: [filmUuid]
                })
            }

            const answerText = isFav ? 'Удалено' : 'Добавлено'

            userPromise.save().then(_ => {
                bot.answerCallbackQuery({
                    callback_query_id: queryId,
                    text: answerText
                })
            }).catch(err => console.log(err))
        }).catch(err => console.log(err))
}

function showFavouriteFilms(chatId, telegramId) {
    User.findOne({telegramId})
        .then(user => {
            if (user) {
                Film.find({uuid: {'$in': user.films}}).then(films => {
                    let html

                    if (films.length) {
                        html = films.map((f, i) => {
                            return `<b>${i + 1}</b> ${f.name} - <b>${f.rate}</b> (/f${f.uuid})`
                        }).join('\n')
                    } else {
                        html = 'Вы пока ничего не добавили'
                    }

                    sendHTML(chatId, html, 'home')
                }).catch(e => console.log(e))
            } else {
                sendHTML(chatId, 'Вы пока ничего не добавили', 'home')
            }

        }).catch(e => console.log(e))
}

function sendCinemasByQuery(userId, query) {
    Cinema.find(query).then(cinemas => {
        console.log(cinemas)
        const html = cinemas.map((c, i) => {
            return `<b>${i + 1}</b> ${c.name} - /${c.uuid}`
        }).join('\n')

        sendHTML(userId, html, 'home')
    })

}