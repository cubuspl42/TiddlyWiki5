/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
(function () {
    /*jslint node: true, browser: true */
    /*global $tw: false */
    "use strict";
    var Promise = require("bluebird");
    var _ = require("underscore");
    var WebTorrent = require('webtorrent');
    var Mutex = require('async-mutex').Mutex;
    // let _ = require("$:/plugins/tiddlywiki/p2p/underscore");
    // let WebTorrent = require("$:/plugins/tiddlywiki/p2p/webtorrent");
    var crypto = require('crypto');
    var ed = require('ed25519-supercop');
    if (Promise) {
        Promise.config({
            longStackTraces: true
        });
    }
    function LocalStorageAdaptor(options) {
        var self = this;
        self.wiki = options.wiki;
        self.logger = new $tw.utils.Logger("LocalStorage");
    }
    LocalStorageAdaptor.prototype.name = "localstorage";
    LocalStorageAdaptor.prototype.isReady = function () {
        var self = this;
        return true;
    };
    LocalStorageAdaptor.prototype.getTiddlerInfo = function (tiddler) {
        var self = this;
        return {};
    };
    /*
    Get an array of skinny tiddler fields from the server
    */
    LocalStorageAdaptor.prototype.getSkinnyTiddlers = function (callback) {
        var self = this;
        var tiddlers = _(_.range(localStorage.length))
            .map(function (i) { return JSON.parse(localStorage.getItem(localStorage.key(i))); });
        console.log("getSkinnyTiddlers", tiddlers);
        callback(null, tiddlers);
    };
    function serializeTiddler(tiddler) {
        var data = _.mapObject(tiddler.fields, function (value, key) { return tiddler.getFieldString(key); });
        return data;
    }
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    LocalStorageAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        var self = this;
        var tiddlerTitle = tiddler.fields.title;
        localStorage.setItem(tiddlerTitle, JSON.stringify(serializeTiddler(tiddler)));
        callback(null);
    };
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
    */
    LocalStorageAdaptor.prototype.loadTiddler = function (title, callback) {
        var self = this;
        // console.log("loadTiddler", title);
        var tiddler = JSON.parse(localStorage.getItem(title));
        callback(null, tiddler);
    };
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    LocalStorageAdaptor.prototype.deleteTiddler = function (title, callback, options) {
        var self = this;
        console.log("deleteTiddler", title);
        localStorage.removeItem(title);
        callback(null);
    };
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
    if (WebTorrent) {
        Promise.promisifyAll(LocalStorageAdaptor.prototype);
        Promise.promisifyAll(WebTorrent.prototype);
        WebTorrent.prototype.addAsync = noErrPromisifier(WebTorrent.prototype.add);
        WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);
    }
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
            Promise.promisifyAll(indexTorrent.__proto__);
            return indexTorrent.onAsync('done');
        })
            .then(function (indexTorrent) { return extractJson(indexTorrent); })
            .finally(torrentClient.destroyAsync())
            .finally(function () { return console.log('< fetchIndex'); });
    }
    function webTorrentClient() {
        var client = WebTorrent({ dht: { verify: ed.verify } });
        Promise.promisifyAll(client.dht);
        return client;
    }
    function PeerToPeerAdaptor(options) {
        console.log('> PeerToPeerAdaptor');
        var self = this;
        self.ready = false;
        self.wiki = options.wiki;
        self.logger = new $tw.utils.Logger("PeerToPeer");
        self.localStorageAdaptor = new LocalStorageAdaptor(options);
        self.dhtTorrentClient = webTorrentClient();
        self.indexTorrentClient = webTorrentClient();
        self.tiddlersTorrentClient = webTorrentClient();
        process.setMaxListeners(50);
        self.mutex = new Mutex();
        self.seq = -1;
        self.index = undefined;
        self.initIndex();
        console.log('< PeerToPeerAdaptor');
    }
    PeerToPeerAdaptor.prototype.name = "p2p";
    PeerToPeerAdaptor.prototype.seedTiddler = function (tiddlerFields) {
        var self = this;
        console.log('Seeding tiddler:', tiddlerFields);
        var buffer = new Buffer(JSON.stringify(tiddlerFields));
        console.log(buffer.toString());
        var tiddlerTorrent = self.tiddlersTorrentClient.get(buffer);
        if (tiddlerTorrent) {
            return Promise.resolve(tiddlerTorrent);
        }
        else {
            return self.tiddlersTorrentClient.seedAsync(buffer, { name: 'tiddler' });
        }
    };
    PeerToPeerAdaptor.prototype.initIndex = function () {
        var self = this;
        console.log("> initIndex");
        var tiddlers = loadAllTiddlers(); // {title: tiddler}
        return self.mutex.runExclusive(function () { return Promise
            .map(_.values(tiddlers), function (tiddlerFields) { return self.seedTiddler(tiddlerFields); })
            .map(function (tiddlerTorrent) { return tiddlerTorrent.infoHash; })
            .then(function (tiddlerTorrentsInfoHashes) {
            console.log("Updating index...");
            self.index = _.object(_.keys(tiddlers), tiddlerTorrentsInfoHashes);
            console.log(self.index);
        })
            .then(function () { return self.seedIndex(); })
            .finally(function () { return console.log("< initIndex"); }); });
    };
    PeerToPeerAdaptor.prototype.seedIndex = function () {
        var self = this;
        return Promise
            .try(function () { return console.log("> seedIndex"); })
            .then(function () { return resetTorrentClient(self.indexTorrentClient); })
            .then(function () {
            var indexJsonBuf = new Buffer(JSON.stringify(self.index));
            console.log("Seeding index...");
            console.log(indexJsonBuf.toString());
            return self.indexTorrentClient.seedAsync(indexJsonBuf, { name: 'index' });
        })
            .then(function (torrent) {
            console.log('Info hash:', torrent.infoHash);
            console.log('Magnet URI:');
            console.log(torrent.magnetURI);
        })
            .finally(function () { return console.log("< seedIndex"); });
    };
    function resetTorrentClient(client) {
        return Promise
            .map(client.torrents, function (torrent) { return client.removeAsync(torrent); });
    }
    function addTiddlerTorrents(newIndex, tiddlersTorrentClient) {
        var indexDelta = _.pick(newIndex, function (tiddlerInfoHash, tiddlerTitle) {
            var oldTiddlerInfoHash = self.index[tiddlerTitle];
            return tiddlerInfoHash !== oldTiddlerInfoHash;
        });
        var tiddlersInfoHashes = _.values(indexDelta);
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
        return Promise
            .try(function () { return addTiddlerTorrents(newIndex, tiddlersTorrentClient); })
            .then(extractTiddlers)
            .map(function (tiddler) { return self.localStorageAdaptor.saveTiddlerAsync(tiddler); });
    }
    function seedNewIndex(newIndex) {
        var newIndexBuffer = new Buffer(JSON.stringify(newIndex));
        return Promise
            .try(function () { return resetTorrentClient(self.indexTorrentClient); })
            .then(function () {
            return self.indexTorrentClient.addAsync(newIndexBuffer);
        }, { name: 'index' }); // ???
    }
    PeerToPeerAdaptor.prototype.pull = function (indexInfoHash) {
        var self = this;
        console.log('> pull');
        var i = fetchIndex(indexInfoHash);
        var t = i.then(function (newIndex) {
            return fetchTiddlers(newIndex, self.tiddlersTorrentClient, self.localStorageAdaptor);
        });
        var s = i.then(seedNewIndex);
        return Promise
            .all(t, s)
            .finally(function () { return console.log('< pull'); });
    };
    PeerToPeerAdaptor.prototype.push = function () {
        var self = this;
        console.log('> push');
        var dht = self.dhtTorrentClient.dht;
        var indexTorrent = self.indexTorrentClient.torrents[0];
        var indexInfoHash = indexTorrent.infoHash;
        return Promise
            .try(function () { return putIndexMetadata(dht, {
            indexInfoHash: new Buffer(indexInfoHash, 'hex')
        }, self.seq); })
            .then(function () {
            self.seq = self.seq + 1;
        })
            .finally(function () { return console.log('< push'); });
        ;
    };
    PeerToPeerAdaptor.prototype.sync = function () {
        var self = this;
        // let dhtTorrentClient = webTorrentClient();
        var dht = self.dhtTorrentClient.dht;
        var indexTorrent = self.indexTorrentClient.torrents[0];
        var indexInfoHash = indexTorrent.infoHash;
        function processResult(res) {
            if (!res) {
                console.log('DHT entry not found');
            }
            else {
                if (res.v.indexInfoHash == indexInfoHash) {
                    self.seq = res.seq;
                }
                if (res.seq > self.seq) {
                    console.log('Index is out of date');
                    self.seq = res.seq;
                    return self.pull(res.v.indexInfoHash.toString('hex'));
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
            .then(function () { return self.push(); })
            .finally(function () { return console.log('< sync'); });
    };
    PeerToPeerAdaptor.prototype.isReady = function () {
        var self = this;
        // console.log('>< isReady', self.index !== undefined);
        return self.index !== undefined;
    };
    PeerToPeerAdaptor.prototype.getTiddlerInfo = function (tiddler) {
        var self = this;
        return self.localStorageAdaptor.getTiddlerInfo(tiddler);
    };
    /*
    Get an array of skinny tiddler fields from the server
    */
    PeerToPeerAdaptor.prototype.getSkinnyTiddlers = function (callback) {
        var self = this;
        return Promise.resolve(self.mutex.runExclusive(function () { return Promise
            .try(function () { return console.log('> getSkinnyTiddlers', self.isReady()); })
            .then(function () { return self.sync(); })
            .then(function () { return self.localStorageAdaptor.getSkinnyTiddlersAsync(); })
            .finally(function () { return console.log('< getSkinnyTiddlers'); }); })).asCallback(callback);
    };
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    PeerToPeerAdaptor.prototype.saveTiddler = function (tiddler, callback) {
        var self = this;
        var tiddlerTitle = tiddler.fields.title;
        var tiddlerFields = serializeTiddler(tiddler);
        Promise
            .try(function () { return console.log("> saveTiddler", tiddlerTitle); })
            .then(function () { return self.localStorageAdaptor.loadTiddlerAsync(tiddlerTitle); })
            .then(function (oldTiddlerFields) {
            console.log(oldTiddlerFields, tiddlerFields);
            if (_.isEqual(oldTiddlerFields, tiddlerFields)) {
                console.log('Tiddler did not change');
                return;
            }
            else {
                return Promise
                    .try(function () {
                    return self.localStorageAdaptor.saveTiddlerAsync(tiddler);
                })
                    .then(function () { return self.seedTiddler(tiddlerFields); })
                    .then(function (tiddlerTorrent) {
                    self.index[tiddlerTitle] = tiddlerTorrent.infoHash;
                })
                    .then(function () { return self.seedIndex(); })
                    .then(function () { return self.push(); })
                    .finally(function () {
                    for (var _i = 0, _a = self.tiddlersTorrentClient.torrents; _i < _a.length; _i++) {
                        var t = _a[_i];
                        console.log(t.infoHash);
                    }
                });
            }
        })
            .finally(function () { return console.log("< saveTiddler", tiddlerTitle); })
            .asCallback(callback);
    };
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
    */
    PeerToPeerAdaptor.prototype.loadTiddler = function (title, callback) {
        var self = this;
        self.localStorageAdaptor.loadTiddler(title, callback);
    };
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    PeerToPeerAdaptor.prototype.deleteTiddler = function (title, callback, options) {
        var self = this;
        Promise.try(function () {
            console.log("> deleteTiddler", title);
            var tiddlerInfoHash = self.index[title];
            if (tiddlerInfoHash !== undefined) {
                console.log(tiddlerInfoHash);
                return self.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
                    .then(function () { return delete self.index[title]; })
                    .then(function () { return self.seedIndex(); })
                    .then(function () { return self.push(); })
                    .then(function () { return Promise.fromCallback(function (callback) { return self.localStorageAdaptor.deleteTiddler(title, callback, options); }); })
                    .catch(function (e) {
                    console.log(e);
                    // console.log(self.tiddlersTorrentClient.)
                    console.log(self.index);
                });
            }
        })
            .finally(function () { return console.log("< deleteTiddler", title); })
            .asCallback(callback);
    };
    if ($tw.browser) {
        exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
    }
})();
