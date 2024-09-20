import { d } from "../helper.js"
import apixt from "../index.js"

const adapter = (config, express) => {
    d("Starting Apixt Express Adapter...")
    let app = express()
    apixt.init(config)

    if (true) {
        app.disable("etag")
        app.get(apixt.config.dumpPath + "/index.js", apixt.handleDumpJs)
        app.get(apixt.config.dumpPath + "/refresh", apixt.handleRefresh)
        app.get(apixt.config.dumpPath, apixt.handleIndex)
        app.post(
            apixt.config.dumpPath,
            express.urlencoded({ extended: true }),
            apixt.handleLogin
        )

        app.use(async (req, res, next) => {
            const active = apixt.active
            req.d = () => {}
            res.d = () => {}
            if (!(active && apixt.checkRequest(req))) {
                next()
                return
            }
            const xt = apixt.bindTo(req, res)
            xt.setHalt(req, res)
            const buffer = []
            const oWrite = res.write.bind(res)
            const oEnd = res.end.bind(res)

            res.write = (chunk, ...args) => {
                buffer.push(chunk)
                oWrite.call(res, chunk, ...args)
            }
            res.end = (chunk, ...args) => {
                let body = ""
                if (!xt.closed) {
                    if (chunk) buffer.push(chunk)

                    apixt.dumpHttpResponse(res, buffer)
                    apixt.dumpTimers(res)
                    xt.end()
                }
                body = xt.body

                res.status(200)
                res.setHeader("Content-Type", "text/json")
                res.setHeader("Content-Length", body.length)

                oEnd.call(res, body, ...args)
            }
            next()
        })
        app = new Proxy(app, {
            get(target, prop) {
                if (prop === "listen") {
                    // target.use(apixt.handleErrors)
                    return target.listen
                }

                if (
                    ["get", "post", "put", "head", "patch", "delete"].includes(
                        prop
                    )
                ) {
                    return (path, ...params) => {
                        apixt.addRoute(path, prop)
                        return target[prop](path, ...params)
                    }
                }
                return target[prop]
            }
        })
    }
    return app
}

export default adapter
