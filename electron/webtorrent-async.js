"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Promise = require("bluebird");
var WebTorrent = require("webtorrent");
function async(file) {
    Promise.promisifyAll(file);
    return file;
}
exports.async = async;
function noErrPromisifier(originalMethod) {
    return function promisified() {
        var args = [].slice.call(arguments);
        var self = this;
        return new Promise(function (resolve, reject) {
            args.push(resolve);
            originalMethod.apply(self, args);
        });
    };
}
Promise.promisifyAll(WebTorrent.prototype);
WebTorrent.prototype.addAsync = noErrPromisifier(WebTorrent.prototype.add);
WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);
