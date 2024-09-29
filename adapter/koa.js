import { d } from "../helper.js"
import apixt from "../index.js"
import { koaBody } from "koa-body"
import debugInst from "debug"
const debug = debugInst("apixt")

const expressReq = (ctx) => ({
    header: (name) => ctx.req.headers[name.toLowerCase()],
    get headers() {
        return ctx.req.headers
    },
    get body() {
        return ctx.request.body
    }
})

const expressRes = (ctx) => ({
    header: (name, value) => (ctx.header[name] = value),
    send: (body) => {
        if (body) ctx.body = body
        ctx.sent = true
    },
    json: (data) => {
        ctx.status = 200
        ctx.set("content-type", "application/json")
        ctx.body = JSON.stringify(data)
        ctx.sent = true
    },
    status: (status) => {
        ctx.status = status
    },
    set(...args) {
        return ctx.set(...args)
    },
    getHeaders() {
        return ctx.response.headers
    },
    get statusCode() {
        return ctx.status
    }
})

const adapter = (config, koa) => {
    debug("Starting Apixt Koa Adapter with config", config)
    let koaApp = new koa()
    apixt.init(config)

    koaApp.use(async (ctx, next) => {
        const { url, method } = ctx.req
        if (method === "GET") {
            if (url === apixt.config.dumpPath) {
                apixt.handleIndex(expressReq(ctx), expressRes(ctx))
            } else if (url === apixt.config.dumpPath + "/index.js") {
                await apixt.handleDumpJs(expressReq(ctx), expressRes(ctx))
            } else if (url === apixt.config.dumpPath + "/refresh") {
                await apixt.handleRefresh(expressReq(ctx), expressRes(ctx))
            }
        } else if (method === "POST" && url === apixt.config.dumpPath) {
            const mw = koaBody({})

            await mw(ctx, async () => {})
            await apixt.handleLogin(expressReq(ctx), expressRes(ctx))
        }
        const sent = ctx.sent

        if (sent) return

        const active = apixt.active
        ctx.d = () => {}
        ctx.req.d = () => {}
        ctx.res.d = () => {}
        if (!(active && apixt.checkRequest(expressReq(ctx)))) {
            await next()
            return
        }

        const res = expressRes(ctx)
        const xt = apixt.bindTo(ctx, res)
        xt.setHalt(expressReq(ctx), res)
        const buffer = []
        const oWrite = ctx.res.write.bind(ctx.res)
        const oEnd = ctx.res.end.bind(ctx.res)

        ctx.res.write = (chunk, ...args) => {
            buffer.push(chunk)
            oWrite.call(ctx.res, chunk, ...args)
        }
        ctx.res.end = (chunk, ...args) => {
            let body = ""
            if (!xt.closed) {
                if (chunk) buffer.push(chunk)

                apixt.dumpHttpResponse(res, buffer)
                apixt.dumpTimers(res)
                xt.end()
            }
            body = xt.body

            ctx.status = 200
            ctx.set("Content-Type", "text/json")
            ctx.set("Content-Length", body.length)

            oEnd.call(ctx.res, body, ...args)
        }
        await next()
    })

    const app = new Proxy(koaApp, {
        get(target, prop) {
            if (prop === "listen") {
                debug("Try to extract routes from router middlewares...")
                for (const mw of koaApp.middleware) {
                    const router = mw.router
                    if (!router) continue

                    for (const layer of router.stack) {
                        debug(
                            `Adding route: ${layer.methods.join(", ")}: ${layer.path}`
                        )
                        apixt.addRoute(layer.path, layer.methods)
                    }
                }

                return target.listen
            }
            return target[prop]
        }
    })

    return app
}

export default adapter
