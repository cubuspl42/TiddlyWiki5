"use strict";
/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
Object.defineProperty(exports, "__esModule", { value: true });
var Promise = require("bluebird");
var underscore_1 = require("underscore");
var WebTorrent = require("webtorrent");
var async_mutex_1 = require("async-mutex");
var crypto = require("crypto");
var ed = require("ed25519-supercop");
require("./webtorrent-async");
Promise.config({
    longStackTraces: true
});
function serializeTiddler(tiddler) {
    var data = underscore_1._.mapObject(tiddler.fields, function (value, key) { return tiddler.getFieldString(key); });
    return data;
}
var LocalStorageAdaptor = (function () {
    function LocalStorageAdaptor(options) {
        this.name = "localstorage";
        this.getSkinnyTiddlersAsync = Promise.promisify(this.getSkinnyTiddlers);
        this.saveTiddlerAsync = Promise.promisify(this.saveTiddler);
        this.loadTiddlerAsync = Promise.promisify(this.loadTiddler);
        this.deleteTiddlerAsync = Promise.promisify(this.deleteTiddler);
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
        var tiddlers = underscore_1._(underscore_1._.range(localStorage.length))
            .map(function (i) { return JSON.parse(localStorage.getItem(localStorage.key(i))); });
        console.log("getSkinnyTiddlers", tiddlers);
        callback(null, tiddlers);
    };
    ;
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    LocalStorageAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        var tiddlerTitle = tiddler.fields.title;
        localStorage.setItem(tiddlerTitle, JSON.stringify(serializeTiddler(tiddler)));
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
    return underscore_1._.chain(underscore_1._.range(localStorage.length))
        .map(function (i) {
        var key = localStorage.key(i);
        return [key, JSON.parse(localStorage.getItem(key))];
    })
        .object()
        .value();
}
function getIndexMetadata(dht) {
    console.log('Getting DHT ready...');
    return Promise
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
function putIndexMetadata(dht, data, oldSeq) {
    console.log('Putting data into DHT...', {
        oldSeq: oldSeq,
        data: data
    });
    return dht.putAsync({
        k: publicKeyBuf,
        v: data,
        cas: oldSeq,
        seq: oldSeq + 1,
        sign: function (buf) {
            return ed.sign(buf, publicKeyBuf, privateKeyBuf);
        }
    });
}
function extractJson(tiddlerTorrent) {
    return tiddlerTorrent.files[0].getBufferAsync()
        .then(function (tiddlerBuffer) { return JSON.parse(tiddlerBuffer.toString('utf-8')); });
}
function fetchIndex(indexInfoHash) {
    var torrentClient = webTorrentClient();
    console.log('> fetchIndex', indexInfoHash);
    var magnetURI = "magnet:?xt=urn:btih:" + indexInfoHash + "&dn=index&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com";
    console.log('Adding torrent:', magnetURI);
    return Promise
        .try(function () { return torrentClient.addAsync(magnetURI); })
        .then(function (indexTorrent) {
        console.log('Torrent ready:', indexTorrent);
        Promise.promisifyAll(Object.getPrototypeOf(indexTorrent));
        return indexTorrent.onAsync('done');
    })
        .then(function (indexTorrent) { return extractJson(indexTorrent); })
        .finally(function () { return torrentClient.destroyAsync(); })
        .finally(function () { return console.log('< fetchIndex'); });
}
function webTorrentClient() {
    var client = new WebTorrent({ dht: { verify: ed.verify } });
    Promise.promisifyAll(client.dht);
    return client;
}
function resetTorrentClient(client) {
    return Promise
        .map(client.torrents, function (torrent) { return client.removeAsync(torrent); });
}
function addTiddlerTorrents(newIndex, tiddlersTorrentClient) {
    var _this = this;
    var indexDelta = underscore_1._.pick(newIndex, function (tiddlerInfoHash, tiddlerTitle) {
        var oldTiddlerInfoHash = _this.index[tiddlerTitle];
        return tiddlerInfoHash !== oldTiddlerInfoHash;
    });
    var tiddlersInfoHashes = underscore_1._.values(indexDelta);
    return Promise.map(tiddlersInfoHashes, function (tiddlerInfoHash) {
        return tiddlersTorrentClient.addAsync(tiddlerInfoHash);
    });
}
function extractTiddlers(tiddlerTorrents) {
    return Promise
        .map(tiddlerTorrents, function (tiddlerTorrent) { return tiddlerTorrent.onAsync('done'); })
        .then(function () { return Promise.map(tiddlerTorrents, extractJson); });
}
function fetchTiddlers(newIndex, tiddlersTorrentClient, localStorageAdaptor) {
    var _this = this;
    return Promise
        .try(function () { return addTiddlerTorrents(newIndex, tiddlersTorrentClient); })
        .then(extractTiddlers)
        .map(function (tiddler) { return _this.localStorageAdaptor.saveTiddlerAsync(tiddler); });
}
var PeerToPeerAdaptor = (function () {
    function PeerToPeerAdaptor(options) {
        this.seq = -1;
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
            return Promise.resolve(tiddlerTorrent);
        }
        else {
            return this.tiddlersTorrentClient.seedAsync(buffer, { name: 'tiddler' });
        }
    };
    PeerToPeerAdaptor.prototype.initIndex = function () {
        var _this = this;
        console.log("> initIndex");
        var tiddlers = loadAllTiddlers(); // {title: tiddler}
        return this.mutex.runExclusive(function () { return Promise
            .map(underscore_1._.values(tiddlers), function (tiddlerFields) { return _this.seedTiddler(tiddlerFields); })
            .map(function (tiddlerTorrent) { return tiddlerTorrent.infoHash; })
            .then(function (tiddlerTorrentsInfoHashes) {
            console.log("Updating index...");
            _this.index = underscore_1._.object(underscore_1._.keys(tiddlers), tiddlerTorrentsInfoHashes);
            console.log(_this.index);
        })
            .then(function () { return _this.seedIndex(); })
            .finally(function () { return console.log("< initIndex"); }); });
    };
    ;
    PeerToPeerAdaptor.prototype.seedIndex = function () {
        var _this = this;
        return Promise
            .try(function () { return console.log("> seedIndex"); })
            .then(function () { return resetTorrentClient(_this.indexTorrentClient); })
            .then(function () {
            var indexJsonBuf = new Buffer(JSON.stringify(_this.index));
            console.log("Seeding index...");
            console.log(indexJsonBuf.toString());
            return _this.indexTorrentClient.seedAsync(indexJsonBuf, { name: 'index' });
        })
            .then(function (torrent) {
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
        return Promise
            .try(function () { return resetTorrentClient(_this.indexTorrentClient); })
            .then(function () { return _this.indexTorrentClient.addAsync(newIndexBuffer, { name: 'index' }); });
    };
    PeerToPeerAdaptor.prototype.pull = function (indexInfoHash) {
        var _this = this;
        console.log('> pull');
        var i = fetchIndex(indexInfoHash);
        var t = i.then(function (newIndex) {
            return fetchTiddlers(newIndex, _this.tiddlersTorrentClient, _this.localStorageAdaptor);
        });
        var s = i.then(this.seedNewIndex);
        return Promise
            .join(t, s, function (a, b) { return null; })
            .finally(function () { return console.log('< pull'); });
    };
    PeerToPeerAdaptor.prototype.push = function () {
        var _this = this;
        console.log('> push');
        var dht = this.dhtTorrentClient.dht;
        var indexTorrent = this.indexTorrentClient.torrents[0];
        var indexInfoHash = indexTorrent.infoHash;
        return Promise
            .try(function () { return putIndexMetadata(dht, {
            indexInfoHash: new Buffer(indexInfoHash, 'hex')
        }, _this.seq); })
            .then(function () {
            _this.seq = _this.seq + 1;
        })
            .finally(function () { return console.log('< push'); });
        ;
    };
    PeerToPeerAdaptor.prototype.sync = function () {
        var _this = this;
        // let dhtTorrentClient = webTorrentClient();
        var dht = this.dhtTorrentClient.dht;
        var indexTorrent = this.indexTorrentClient.torrents[0];
        var indexInfoHash = indexTorrent.infoHash;
        var self = this;
        function processResult(res) {
            if (!res) {
                console.log('DHT entry not found');
            }
            else {
                var resIndexInfoHash = res.v.indexInfoHash.toString('hex');
                console.log(resIndexInfoHash, indexInfoHash);
                if (resIndexInfoHash == indexInfoHash) {
                    self.seq = res.seq;
                }
                if (res.seq > self.seq) {
                    console.log('Index is out of date');
                    self.seq = res.seq;
                    return self.pull(resIndexInfoHash);
                }
                else {
                    console.log('Index is up to date');
                }
            }
        }
        return Promise
            .try(function () { return console.log('> sync'); })
            .then(function () { return getIndexMetadata(dht); })
            .then(processResult)
            .then(function () { return _this.push(); })
            .finally(function () { return console.log('< sync'); });
    };
    ;
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
        var _this = this;
        return Promise.resolve(this.mutex.runExclusive(function () { return Promise
            .try(function () { return console.log('> getSkinnyTiddlers', _this.isReady()); })
            .then(function () { return _this.sync(); })
            .then(function () { return _this.localStorageAdaptor.getSkinnyTiddlersAsync(); })
            .finally(function () { return console.log('< getSkinnyTiddlers'); }); })).asCallback(callback);
    };
    ;
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    PeerToPeerAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        var _this = this;
        var tiddlerTitle = tiddler.fields.title;
        var tiddlerFields = serializeTiddler(tiddler);
        Promise
            .try(function () { return console.log("> saveTiddler", tiddlerTitle); })
            .then(function () { return _this.localStorageAdaptor.loadTiddlerAsync(tiddlerTitle); })
            .then(function (oldTiddlerFields) {
            console.log(oldTiddlerFields, tiddlerFields);
            if (underscore_1._.isEqual(oldTiddlerFields, tiddlerFields)) {
                console.log('Tiddler did not change');
                return;
            }
            else {
                return Promise
                    .try(function () {
                    return _this.localStorageAdaptor.saveTiddlerAsync(tiddler);
                })
                    .then(function () { return _this.seedTiddler(tiddlerFields); })
                    .then(function (tiddlerTorrent) {
                    _this.index[tiddlerTitle] = tiddlerTorrent.infoHash;
                })
                    .then(function () { return _this.seedIndex(); })
                    .then(function () { return _this.push(); })
                    .finally(function () {
                    for (var _i = 0, _a = _this.tiddlersTorrentClient.torrents; _i < _a.length; _i++) {
                        var t = _a[_i];
                        console.log(t.infoHash);
                    }
                });
            }
        })
            .finally(function () { return console.log("< saveTiddler", tiddlerTitle); })
            .asCallback(callback);
    };
    ;
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
    */
    PeerToPeerAdaptor.prototype.loadTiddler = function (title, callback) {
        this.localStorageAdaptor.loadTiddler(title, callback);
    };
    ;
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    PeerToPeerAdaptor.prototype.deleteTiddler = function (title, callback, options) {
        var _this = this;
        Promise
            .try(function () {
            console.log("> deleteTiddler", title);
            var tiddlerInfoHash = _this.index[title];
            if (tiddlerInfoHash !== undefined) {
                console.log(tiddlerInfoHash);
                return _this.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
                    .then(function () { return delete _this.index[title]; })
                    .then(function () { return _this.seedIndex(); })
                    .then(function () { return _this.push(); })
                    .then(function () { return Promise.fromCallback(function (callback) { return _this.localStorageAdaptor.deleteTiddler(title, callback, options); }); })
                    .catch(function (e) {
                    console.log(e);
                    // console.log(this.tiddlersTorrentClient.)
                    console.log(_this.index);
                });
            }
        })
            .finally(function () { return console.log("< deleteTiddler", title); })
            .asCallback(callback);
    };
    ;
    return PeerToPeerAdaptor;
}());
exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
