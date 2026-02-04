import { DEV_RUNTIME_SCRIPT, DEV_RUNTIME_PATH } from "./consts.mjs";
export const devInjectMiddleware = (req, res, next) => {
  if (!req.url) return next();
  if (req.url.startsWith(DEV_RUNTIME_PATH)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript');
    res.end(DEV_RUNTIME_SCRIPT);
    return;
  }
  next();
};