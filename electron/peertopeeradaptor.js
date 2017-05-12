"use strict";
/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var Bluebird = require("bluebird");
var _ = require("underscore");
var WebTorrent = require("webtorrent");
var webtorrent_async_1 = require("./webtorrent-async");
var async_mutex_1 = require("async-mutex");
var crypto = require("crypto");
var ed = require("ed25519-supercop");
require("./webtorrent-async");
Bluebird.config({
    longStackTraces: true
});
function extractFields(tiddler) {
    var data = _.mapObject(tiddler.fields, function (value, key) { return tiddler.getFieldString(key); });
    return data;
}
function saveTiddlerFields(tiddlerFields) {
    var tiddlerTitle = tiddlerFields.title;
    localStorage.setItem(tiddlerTitle, JSON.stringify(tiddlerFields));
}
var LocalStorageAdaptor = (function () {
    function LocalStorageAdaptor(options) {
        this.name = "localstorage";
        this.getSkinnyTiddlersAsync = Bluebird.promisify(this.getSkinnyTiddlers);
        this.saveTiddlerAsync = Bluebird.promisify(this.saveTiddler);
        this.loadTiddlerAsync = Bluebird.promisify(this.loadTiddler);
        this.deleteTiddlerAsync = Bluebird.promisify(this.deleteTiddler);
        this.wiki = options.wiki;
        this.logger = new $tw.utils.Logger("LocalStorage");
    }
    LocalStorageAdaptor.prototype.isReady = function () {
        return true;
    };
    ;
    LocalStorageAdaptor.prototype.getTiddlerInfo = function (tiddler) {
        return {};
    };
    ;
    /*
    Get an array of skinny tiddler fields from the server
    */
    LocalStorageAdaptor.prototype.getSkinnyTiddlers = function (callback) {
        var tiddlers = _(_.range(localStorage.length))
            .map(function (i) { return JSON.parse(localStorage.getItem(localStorage.key(i))); });
        console.log("getSkinnyTiddlers", tiddlers);
        callback(null, tiddlers);
    };
    ;
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    LocalStorageAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        saveTiddlerFields(extractFields(tiddler));
        callback(null);
    };
    ;
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
    */
    LocalStorageAdaptor.prototype.loadTiddler = function (title, callback) {
        // console.log("loadTiddler", title);
        var tiddler = JSON.parse(localStorage.getItem(title));
        callback(null, tiddler);
    };
    ;
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    LocalStorageAdaptor.prototype.deleteTiddler = function (title, callback, options) {
        console.log("deleteTiddler", title);
        localStorage.removeItem(title);
        callback(null);
    };
    ;
    return LocalStorageAdaptor;
}());
var keypair = require('./keypair.json');
var publicKey = keypair.publicKey;
var privateKey = keypair.secretKey;
var publicKeyBuf = new Buffer(publicKey, 'hex');
var privateKeyBuf = new Buffer(privateKey, 'hex');
var targetId = crypto.createHash('sha1').update(publicKeyBuf).digest('hex');
function loadAllTiddlers() {
    return _.chain(_.range(localStorage.length))
        .map(function (i) {
        var key = localStorage.key(i);
        return [key, JSON.parse(localStorage.getItem(key))];
    })
        .object()
        .value();
}
function getIndexMetadata(dht) {
    console.log('Getting DHT ready...');
    return Bluebird
        .try(function () { return dht.getAsync(targetId); })
        .then(function (res) {
        console.log('Received DHT entry:', res);
        if (res) {
            console.log('Seq:', res.seq);
            console.log('Index info hash:', res.v.indexInfoHash.toString('hex'));
        }
        return res;
    });
}
function putIndexMetadata(dht, data, cas, seq) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('Putting data into DHT...', {
                cas: cas,
                seq: seq
            });
            return [2 /*return*/, dht.putAsync({
                    k: publicKeyBuf,
                    v: data,
                    // cas: cas < 0 ? undefined : cas,
                    seq: seq,
                    sign: function (buf) {
                        return ed.sign(buf, publicKeyBuf, privateKeyBuf);
                    }
                })];
        });
    });
}
function extractJson(tiddlerTorrent) {
    return __awaiter(this, void 0, void 0, function () {
        var tiddlerBuffer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('Extracting JSON...');
                    return [4 /*yield*/, webtorrent_async_1.async(tiddlerTorrent.files[0]).getBufferAsync()];
                case 1:
                    tiddlerBuffer = _a.sent();
                    return [2 /*return*/, JSON.parse(tiddlerBuffer.toString('utf-8'))];
            }
        });
    });
}
function fetchTorrent(torrentClient, magnetURI) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Bluebird(function (resolve) {
                    torrentClient.add(magnetURI, function (torrent) {
                        console.log('Torrent ready:', torrent.files);
                        torrent.on('done', function () {
                            console.log('Torrent done');
                            resolve(torrent);
                        });
                    });
                }).timeout(15000)];
        });
    });
}
function makeMagnetURI(infoHash) {
    var magnetURI = "magnet:?xt=urn:btih:" + infoHash + "&dn=index&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com";
    return magnetURI;
}
function fetchIndex(indexInfoHash) {
    return __awaiter(this, void 0, void 0, function () {
        var torrentClient, magnetURI, indexTorrent, index;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    torrentClient = webTorrentClient();
                    console.log('> fetchIndex', indexInfoHash);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 4, 6]);
                    magnetURI = makeMagnetURI(indexInfoHash);
                    return [4 /*yield*/, fetchTorrent(torrentClient, magnetURI)];
                case 2:
                    indexTorrent = _a.sent();
                    return [4 /*yield*/, extractJson(indexTorrent)];
                case 3:
                    index = _a.sent();
                    return [2 /*return*/, index];
                case 4:
                    console.log('Destroying torrent client...');
                    return [4 /*yield*/, torrentClient.destroyAsync()];
                case 5:
                    _a.sent();
                    console.log('< fetchIndex');
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function webTorrentClient() {
    var client = new WebTorrent({ dht: { verify: ed.verify } });
    Bluebird.promisifyAll(client.dht);
    return client;
}
function resetTorrentClient(client) {
    return Bluebird
        .map(client.torrents, function (torrent) { return client.removeAsync(torrent); });
}
function findDifferentTiddlers(oldIndex, newIndex) {
    var indexDelta = _.pick(newIndex, function (tiddlerInfoHash, tiddlerTitle) {
        var oldTiddlerInfoHash = oldIndex[tiddlerTitle];
        return tiddlerInfoHash !== oldTiddlerInfoHash;
    });
    var tiddlersInfoHashes = _.values(indexDelta);
    return tiddlersInfoHashes;
}
function fetchTiddlerTorrents(oldIndex, newIndex, tiddlersTorrentClient) {
    var indexDelta = _.pick(newIndex, function (tiddlerInfoHash, tiddlerTitle) {
        var oldTiddlerInfoHash = oldIndex[tiddlerTitle];
        return tiddlerInfoHash !== oldTiddlerInfoHash;
    });
    var tiddlersInfoHashes = _.values(indexDelta);
    return Bluebird.map(tiddlersInfoHashes, function (tiddlerInfoHash) {
        return fetchTorrent(tiddlersTorrentClient, makeMagnetURI(tiddlerInfoHash));
    });
}
function fetchTiddlers(oldIndex, newIndex, tiddlersTorrentClient, localStorageAdaptor) {
    return Bluebird
        .try(function () { return fetchTiddlerTorrents(oldIndex, newIndex, tiddlersTorrentClient); })
        .map(function (tiddlerTorrent) { return extractJson(tiddlerTorrent); })
        .map(function (tiddlerFields) { return saveTiddlerFields(tiddlerFields); });
    // findDifferentTiddlers.map
    //	fetch -> extract -> save -> seed ?
    // Bluebird.join()
}
function fetchTiddler(tiddlersTorrentClient, localStorageAdaptor, tiddlerInfoHash) {
    return __awaiter(this, void 0, void 0, function () {
        var magnetURI, tiddlerTorrent, tiddlerFields;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    magnetURI = makeMagnetURI(tiddlerInfoHash);
                    return [4 /*yield*/, fetchTorrent(tiddlersTorrentClient, magnetURI)];
                case 1:
                    tiddlerTorrent = _a.sent();
                    return [4 /*yield*/, extractJson(tiddlerTorrent)];
                case 2:
                    tiddlerFields = _a.sent();
                    saveTiddlerFields(tiddlerFields);
                    return [2 /*return*/];
            }
        });
    });
}
var PeerToPeerAdaptor = (function () {
    function PeerToPeerAdaptor(options) {
        this.seq = 0;
        this.mutex = new async_mutex_1.Mutex();
        this.index = undefined;
        this.name = "p2p";
        console.log('> PeerToPeerAdaptor');
        this.ready = false;
        this.wiki = options.wiki;
        this.logger = new $tw.utils.Logger("PeerToPeer");
        this.localStorageAdaptor = new LocalStorageAdaptor(options);
        this.dhtTorrentClient = webTorrentClient();
        this.indexTorrentClient = webTorrentClient();
        this.tiddlersTorrentClient = webTorrentClient();
        process.setMaxListeners(50);
        this.initIndex();
        console.log('< PeerToPeerAdaptor');
    }
    PeerToPeerAdaptor.prototype.seedTiddler = function (tiddlerFields) {
        console.log('Seeding tiddler:', tiddlerFields);
        var buffer = new Buffer(JSON.stringify(tiddlerFields));
        console.log(buffer.toString());
        var tiddlerTorrent = this.tiddlersTorrentClient.get(buffer);
        if (tiddlerTorrent) {
            return Bluebird.resolve(tiddlerTorrent);
        }
        else {
            return this.tiddlersTorrentClient.seedAsync(buffer, { name: 'tiddler' });
        }
    };
    PeerToPeerAdaptor.prototype.initIndex = function () {
        var _this = this;
        console.log("> initIndex");
        var tiddlers = loadAllTiddlers(); // {title: tiddler}
        return this.mutex.runExclusive(function () { return Bluebird
            .map(_.values(tiddlers), function (tiddlerFields) { return _this.seedTiddler(tiddlerFields); })
            .map(function (tiddlerTorrent) { return tiddlerTorrent.infoHash; })
            .then(function (tiddlerTorrentsInfoHashes) {
            console.log("Updating index...");
            _this.index = _.object(_.keys(tiddlers), tiddlerTorrentsInfoHashes);
            console.log(_this.index);
        })
            .then(function () { return _this.seedIndex(); })
            .finally(function () { return console.log("< initIndex"); }); });
    };
    ;
    PeerToPeerAdaptor.prototype.seedIndex = function () {
        var _this = this;
        return Bluebird
            .try(function () { return console.log("> seedIndex"); })
            .then(function () { return resetTorrentClient(_this.indexTorrentClient); })
            .then(function () {
            var indexJsonBuf = new Buffer(JSON.stringify(_this.index));
            console.log("Seeding index...");
            console.log(indexJsonBuf.toString());
            return _this.indexTorrentClient.seedAsync(indexJsonBuf, { name: 'index' });
        })
            .then(function (torrent) {
            console.log('Index torrent:', torrent);
            console.log('Info hash:', torrent.infoHash);
            console.log('Magnet URI:');
            console.log(torrent.magnetURI);
        })
            .finally(function () { return console.log("< seedIndex"); });
    };
    ;
    PeerToPeerAdaptor.prototype.seedNewIndex = function (newIndex) {
        var _this = this;
        var newIndexBuffer = new Buffer(JSON.stringify(newIndex));
        return Bluebird
            .try(function () { return resetTorrentClient(_this.indexTorrentClient); })
            .then(function () { return _this.indexTorrentClient.addAsync(newIndexBuffer, { name: 'index' }); });
    };
    PeerToPeerAdaptor.prototype.pull = function (indexInfoHash) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var newIndex, differentTiddlers;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log('> pull');
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, , 4, 5]);
                        return [4 /*yield*/, fetchIndex(indexInfoHash)];
                    case 2:
                        newIndex = _a.sent();
                        console.log('newIndex:', newIndex);
                        differentTiddlers = findDifferentTiddlers(this.index, newIndex);
                        return [4 /*yield*/, Bluebird.map(differentTiddlers, function (tiddlerInfoHash) { return fetchTiddler(_this.tiddlersTorrentClient, _this.localStorageAdaptor, tiddlerInfoHash); })];
                    case 3:
                        _a.sent();
                        this.index = newIndex;
                        return [3 /*break*/, 5];
                    case 4:
                        console.log('< pull');
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    PeerToPeerAdaptor.prototype.pushMetadata = function (dht, seqNext) {
        return __awaiter(this, void 0, void 0, function () {
            var indexTorrent, indexInfoHash;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log('> push');
                        indexTorrent = this.indexTorrentClient.torrents[0];
                        indexInfoHash = indexTorrent.infoHash;
                        return [4 /*yield*/, putIndexMetadata(dht, {
                                indexInfoHash: new Buffer(indexInfoHash, 'hex')
                            }, this.seq, seqNext)];
                    case 1:
                        _a.sent();
                        this.seq = seqNext;
                        console.log('< push');
                        return [2 /*return*/];
                }
            });
        });
    };
    PeerToPeerAdaptor.prototype.sync = function (dht) {
        return __awaiter(this, void 0, void 0, function () {
            var indexTorrent, indexInfoHash, res, resIndexInfoHash;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log('> sync');
                        indexTorrent = this.indexTorrentClient.torrents[0];
                        indexInfoHash = indexTorrent.infoHash;
                        return [4 /*yield*/, getIndexMetadata(dht)];
                    case 1:
                        res = _a.sent();
                        if (!!res) return [3 /*break*/, 3];
                        console.log('DHT entry not found');
                        return [4 /*yield*/, this.pushMetadata(dht, this.seq)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 8];
                    case 3:
                        resIndexInfoHash = res.v.indexInfoHash.toString('hex');
                        console.log(resIndexInfoHash, indexInfoHash);
                        if (!(res.seq < this.seq)) return [3 /*break*/, 5];
                        console.log('Remote index is out of date', {
                            remoteSeq: res.seq,
                            localSeq: this.seq
                        });
                        // throw new Error('Remote index is out of date');
                        return [4 /*yield*/, this.pushMetadata(dht, this.seq)];
                    case 4:
                        // throw new Error('Remote index is out of date');
                        _a.sent();
                        return [3 /*break*/, 8];
                    case 5:
                        if (!(res.seq > this.seq)) return [3 /*break*/, 7];
                        console.log('Local index is out of date', {
                            remoteSeq: res.seq,
                            localSeq: this.seq
                        });
                        return [4 /*yield*/, this.pull(resIndexInfoHash)];
                    case 6:
                        _a.sent();
                        this.seq = res.seq;
                        return [3 /*break*/, 8];
                    case 7:
                        console.log('Index is up to date');
                        _a.label = 8;
                    case 8:
                        console.log('< sync');
                        return [2 /*return*/];
                }
            });
        });
    };
    ;
    PeerToPeerAdaptor.prototype.trySync = function () {
        return __awaiter(this, void 0, void 0, function () {
            var dhtTorrentClient, dht, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.info('> trySync');
                        _a.label = 1;
                    case 1:
                        if (!true) return [3 /*break*/, 9];
                        dhtTorrentClient = webTorrentClient();
                        dht = dhtTorrentClient.dht;
                        return [4 /*yield*/, dht.onAsync('ready')];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, 6, 8]);
                        console.log('Trying to sync...');
                        return [4 /*yield*/, this.sync(dht)];
                    case 4:
                        _a.sent();
                        return [2 /*return*/];
                    case 5:
                        e_1 = _a.sent();
                        console.error("Sync error: " + e_1);
                        console.info('Retrying...');
                        return [3 /*break*/, 8];
                    case 6: return [4 /*yield*/, dhtTorrentClient.destroyAsync()];
                    case 7:
                        _a.sent();
                        console.log('< trySync');
                        return [7 /*endfinally*/];
                    case 8: return [3 /*break*/, 1];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    PeerToPeerAdaptor.prototype.isReady = function () {
        // console.log('>< isReady', this.index !== undefined);
        return this.index !== undefined;
    };
    ;
    PeerToPeerAdaptor.prototype.getTiddlerInfo = function (tiddler) {
        return this.localStorageAdaptor.getTiddlerInfo(tiddler);
    };
    ;
    /*
    Get an array of skinny tiddler fields from the server
    */
    PeerToPeerAdaptor.prototype.getSkinnyTiddlers = function (callback) {
        // let dhtTorrentClient = webTorrentClient();
        // let dht = this.dhtTorrentClient.dht;
        var _this = this;
        return Bluebird.resolve(this.mutex.runExclusive(function () { return Bluebird
            .try(function () { return console.log('> getSkinnyTiddlers', _this.isReady()); })
            .then(function () { return _this.trySync(); })
            .then(function () { return _this.localStorageAdaptor.getSkinnyTiddlersAsync(); })
            .finally(function () { return console.log('< getSkinnyTiddlers'); }); })).asCallback(callback);
    };
    ;
    PeerToPeerAdaptor.prototype.saveTiddlerAsync = function (tiddler) {
        return __awaiter(this, void 0, void 0, function () {
            var dhtTorrentClient, dht, tiddlerTitle, tiddlerFields, oldTiddlerFields, tiddlerTorrent;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        dhtTorrentClient = webTorrentClient();
                        dht = dhtTorrentClient.dht;
                        tiddlerTitle = tiddler.fields.title;
                        tiddlerFields = extractFields(tiddler);
                        if (!(tiddlerTitle[0] == '$' || tiddlerTitle.startsWith('Draft'))) return [3 /*break*/, 1];
                        return [3 /*break*/, 13];
                    case 1:
                        _a.trys.push([1, , 11, 13]);
                        console.log("> saveTiddler", tiddlerTitle);
                        return [4 /*yield*/, dht.onAsync('ready')];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, this.sync(dht)];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, this.localStorageAdaptor.loadTiddlerAsync(tiddlerTitle)];
                    case 4:
                        oldTiddlerFields = _a.sent();
                        if (!_.isEqual(oldTiddlerFields, tiddlerFields)) return [3 /*break*/, 5];
                        console.log('Tiddler did not change');
                        return [2 /*return*/];
                    case 5: return [4 /*yield*/, this.localStorageAdaptor.saveTiddlerAsync(tiddler)];
                    case 6:
                        _a.sent();
                        return [4 /*yield*/, this.seedTiddler(tiddlerFields)];
                    case 7:
                        tiddlerTorrent = _a.sent();
                        this.index[tiddlerTitle] = tiddlerTorrent.infoHash;
                        return [4 /*yield*/, this.seedIndex()];
                    case 8:
                        _a.sent();
                        return [4 /*yield*/, this.pushMetadata(dht, this.seq + 1)];
                    case 9:
                        _a.sent();
                        _a.label = 10;
                    case 10: return [3 /*break*/, 13];
                    case 11: return [4 /*yield*/, dhtTorrentClient.destroyAsync()];
                    case 12:
                        _a.sent();
                        console.log("< saveTiddler", tiddlerTitle);
                        return [7 /*endfinally*/];
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    PeerToPeerAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        Bluebird.resolve(this.saveTiddlerAsync(tiddler)).asCallback(callback);
    };
    ;
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
    */
    PeerToPeerAdaptor.prototype.loadTiddler = function (title, callback) {
        this.localStorageAdaptor.loadTiddler(title, callback);
    };
    ;
    PeerToPeerAdaptor.prototype.deleteTiddlerAsync = function (title, options) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                Bluebird
                    .try(function () {
                    console.log("> deleteTiddler", title);
                    var tiddlerInfoHash = _this.index[title];
                    if (tiddlerInfoHash !== undefined) {
                        console.log(tiddlerInfoHash);
                        return _this.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
                            .then(function () { return delete _this.index[title]; })
                            .then(function () { return _this.seedIndex(); })
                            .then(function () { return _this.pushMetadata(null, null); }) // FIXME
                            .then(function () { return Bluebird.fromCallback(function (callback) { return _this.localStorageAdaptor.deleteTiddler(title, callback, options); }); })
                            .catch(function (e) {
                            console.log(e);
                            // console.log(this.tiddlersTorrentClient.)
                            console.log(_this.index);
                        });
                    }
                })
                    .finally(function () { return console.log("< deleteTiddler", title); });
                return [2 /*return*/];
            });
        });
    };
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    PeerToPeerAdaptor.prototype.deleteTiddler = function (title, callback, options) {
        callback(null);
        // Bluebird.resolve(this.deleteTiddlerAsync(title, options)).asCallback(callback);
    };
    ;
    return PeerToPeerAdaptor;
}());
exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
