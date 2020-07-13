function debug(obj = {}) {
    return JSON.stringify(obj, null, 4)
}

function logStart() {
    console.log('Bot has been started...')
}

function getChatId(msg) {
    return msg.chat.id
}

function getItemUuid(source) {
    console.log(source)
    return source.substr(1, source.length)
}
module.exports = {
    debug,
    logStart,
    getChatId,
    getItemUuid,
}