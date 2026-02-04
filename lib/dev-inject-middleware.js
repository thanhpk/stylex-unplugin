"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.devInjectMiddleware = void 0;
var _consts = require("./consts");
const devInjectMiddleware = (req, res, next) => {
  if (!req.url) return next();
  if (req.url.startsWith(_consts.DEV_RUNTIME_PATH)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript');
    res.end(_consts.DEV_RUNTIME_SCRIPT);
    return;
  }
  next();
};
exports.devInjectMiddleware = devInjectMiddleware;