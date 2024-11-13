const obj = {}
;(async () => {
    obj.apixt = await import("./index.js")
    obj.adapter = await import("./adapter/koa.js")
})()

module.exports = obj
