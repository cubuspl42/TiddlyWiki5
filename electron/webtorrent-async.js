"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Promise = require("bluebird");
var WebTorrent = require("webtorrent");
function noErrPromisifier(originalMethod) {
    return function promisified() {
        var args = [].slice.call(arguments); // might want to use smarter
        var self = this; // promisification if performance critical
        return new Promise(function (resolve, reject) {
            args.push(resolve);
            originalMethod.apply(self, args); // call with arguments
        });
    };
}
Promise.promisifyAll(WebTorrent.prototype);
WebTorrent.prototype.addAsync = noErrPromisifier(WebTorrent.prototype.add);
WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);
