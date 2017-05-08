/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

let Promise = require("bluebird");
let _ = require("underscore");
let WebTorrent = require('webtorrent');
let Mutex = require('async-mutex').Mutex;

// let _ = require("$:/plugins/tiddlywiki/p2p/underscore");
// let WebTorrent = require("$:/plugins/tiddlywiki/p2p/webtorrent");
let crypto = require('crypto');
let ed = require('ed25519-supercop');

if(Promise) {
	Promise.config({
		longStackTraces: true
	});
}

function LocalStorageAdaptor(options) {
	let self = this;
	self.wiki = options.wiki;
	self.logger = new $tw.utils.Logger("LocalStorage");
}

LocalStorageAdaptor.prototype.name = "localstorage";

LocalStorageAdaptor.prototype.isReady = function() {
	let self = this;
	return true;
};

LocalStorageAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	let self = this;
	return {};
};

/*
Get an array of skinny tiddler fields from the server
*/
LocalStorageAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	let self = this;
	let tiddlers = _(_.range(localStorage.length))
		.map((i) => JSON.parse(localStorage.getItem(localStorage.key(i))));
	console.log("getSkinnyTiddlers", tiddlers);
	callback(null, tiddlers);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
LocalStorageAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	let self = this;
	let tiddlerTitle = tiddler.fields.title;
	let data = _.mapObject(tiddler.fields, (value, key) => tiddler.getFieldString(key));
	console.log("saveTiddler", data);
	localStorage.setItem(tiddlerTitle, JSON.stringify(data));
	callback(null);
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)
*/
LocalStorageAdaptor.prototype.loadTiddler = function(title,callback) {
	let self = this;
	// console.log("loadTiddler", title);
	let tiddler = JSON.parse(localStorage.getItem(title));
	callback(null, tiddler);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
LocalStorageAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	let self = this;
	console.log("deleteTiddler", title);
	localStorage.removeItem(title);
	callback(null);
};


function noErrPromisifier(originalMethod) {
	return function promisified() {
		var args = [].slice.call(arguments); // might want to use smarter
		var self = this                      // promisification if performance critical
		return new Promise(function(resolve,reject) {
			args.push(resolve); 
			originalMethod.apply(self,args); // call with arguments
		});
	};
}

if(WebTorrent) {
	Promise.promisifyAll(LocalStorageAdaptor.prototype);
	Promise.promisifyAll(WebTorrent.prototype);
	WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);	
}

let keypair =
{ publicKey: '824b3c901df3ee9d60a9fd69c9fb2d2c7f8c021922934f14cf6066db4563cca6',
  secretKey: '2007a78560695bb9944adbd10c7d2cecd901929c4d84865ccdd08fea19d78166e51c20d9408caefc576eb49b4e3412d67cfb9047d7f29ca8d4ea93882abb463c' }

let publicKey = keypair.publicKey;
let privateKey = keypair.secretKey;
let publicKeyBuf = Buffer(publicKey, 'hex');
let privateKeyBuf = Buffer(privateKey, 'hex');
let targetId = crypto.createHash('sha1').update(publicKeyBuf).digest('hex');

function loadAllTiddlers() {
	return _.chain(_.range(localStorage.length))
		.map((i) => {
			let key = localStorage.key(i);
			return [key, JSON.parse(localStorage.getItem(key))];
		})
		.object()
		.value();
}

function getIndexMetadata(dht) {
	console.log('Getting DHT ready...');
	return Promise
		.try(() => dht.getAsync(targetId))
		.then((res) => {
			console.log('Received DHT entry:', res.seq);
			if(res) {
				console.log('Index info hash:', res.v.indexInfoHash.toString('hex'));
			}
			return res;
		});
}

function putIndexMetadata(dht, data, oldSeq) {
	console.log('Putting data into DHT...', {
		oldSeq: oldSeq
	});
	return dht.putAsync({
		k: publicKeyBuf,
		v: data,
		cas: oldSeq,
		seq: oldSeq + 1,
		sign: function (buf) {
			return ed.sign(buf, publicKeyBuf, privateKeyBuf)
		}
	});
}

function extractJson(tiddlerTorrent) {
	return tiddlerTorrent.files[0].getBufferAsync()
		.then((tiddlerBuffer) => JSON.parse(tiddlerBuffer.toString('utf-8')));
}

function fetchIndex(indexInfoHash) {
	let torrentClient = webTorrentClient();

	console.log('> fetchIndex', indexInfoHash);

	let indexTorrent = torrentClient.add(indexInfoHash);
	Promise.promisifyAll(indexTorrent.__proto__);

	return Promise
		.try(() => indexTorrent.onAsync('done'))
		.then((indexTorrent) => extractJson(indexTorrent))
		.finally(torrentClient.destroyAsync())
		.finally(() => console.log('< fetchIndex'));
}

function webTorrentClient() {
	let client = WebTorrent({dht: {verify: ed.verify}});
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

PeerToPeerAdaptor.prototype.seedTiddler = function(tiddler) {
	let self = this;
	console.log('Seeding tiddler:', tiddler);
	let buffer = Buffer(JSON.stringify(tiddler));
	return self.tiddlersTorrentClient.seedAsync(buffer, {name: 'tiddler'});
}

PeerToPeerAdaptor.prototype.initIndex = function() {
	let self = this;
	console.log("> initIndex");

	let tiddlers = loadAllTiddlers(); // {title: tiddler}

	return self.mutex.runExclusive(() => Promise
		.map(_.values(tiddlers), (tiddler) => self.seedTiddler(tiddler))
		.map((tiddlerTorrent) => tiddlerTorrent.infoHash)
		.then((tiddlerTorrentsInfoHashes) => {
			console.log("Updating index...");
			self.index = _.object(tiddlerTorrentsInfoHashes, _.keys(tiddlers));
		})
		.then(() => self.seedIndex())
		.finally(() => console.log("< initIndex"))
	);
};

PeerToPeerAdaptor.prototype.seedIndex = function() {
	var self = this;

	return Promise
		.try(() => console.log("> seedIndex"))
		.then(() => resetTorrentClient(self.indexTorrentClient))
		.then(() => {
			let indexJsonBuf = Buffer(JSON.stringify(self.index));
			console.log("Seeding index...");
			return self.indexTorrentClient.seedAsync(indexJsonBuf, {name: 'index'});
		})
		// .then(() => self.push())
		.finally(() => console.log("< seedIndex"));
};

function resetTorrentClient(client) {
	return Promise
		.map(client.torrents, (torrent) => client.removeAsync(torrent));
}

function addTiddlerTorrents(newIndex, tiddlersTorrentClient) {
	let indexDelta = _.pick(newIndex, (tiddlerInfoHash, tiddlerTitle) => {
		let oldTiddlerInfoHash = self.index[tiddlerTitle];
		return tiddlerInfoHash !== oldTiddlerInfoHash;
	});
	let tiddlersInfoHashes = _.values(indexDelta);
	return Promise.map(tiddlersInfoHashes,
		tiddlersTorrentClient.add(tiddlerInfoHash));
}

function extractTiddlers(tiddlerTorrents) {
	return Promise
		.map(tiddlerTorrents, 
			(tiddlerTorrent) => tiddlerTorrent.onAsync('done'))
		.then(() => Promise.map(tiddlerTorrents, extractJson));

}

function fetchTiddlers(newIndex, tiddlersTorrentClient, localStorageAdaptor) {
	return Promise
		.try(() => addTiddlerTorrents(newIndex, tiddlersTorrentClient))
		.then(extractTiddlers)
		.map((tiddler) => self.localStorageAdaptor.saveTiddlerAsync(tiddler));
}

function seedNewIndex(newIndex) {
	let newIndexBuffer = new Buffer(JSON.stringify(newIndex));

	return Promise
		.try(() => resetTorrentClient(self.indexTorrentClient))
		.then(() =>
			self.indexTorrentClient.addAsync(newIndexBuffer), {name: 'index'})
}

PeerToPeerAdaptor.prototype.pull = function(indexInfoHash) {
	let self = this;
	console.log('> pull');

	let i = fetchIndex(indexInfoHash);
	let t = i.then((newIndex) =>
		fetchTiddlers(
			newIndex,
			self.tiddlersTorrentClient,
			self.localStorageAdaptor))
	let s = i.then(seedNewIndex);
	return Promise
		.all(t, s)
		.finally(() => console.log('< pull'));
}

PeerToPeerAdaptor.prototype.push = function() {
	let self = this;
	console.log('> push');

	let dht = self.dhtTorrentClient.dht;
	let indexTorrent = self.indexTorrentClient.torrents[0];
	let indexInfoHash = indexTorrent.infoHash;

	return Promise
		.try(() => putIndexMetadata(dht, {
			indexInfoHash: indexInfoHash
		}, self.seq))
		.then(() => {
			self.seq = self.seq + 1;
		})
		.finally(() => console.log('< push'));;
}


PeerToPeerAdaptor.prototype.sync = function() {
	let self = this;
	// let dhtTorrentClient = webTorrentClient();
	let dht = self.dhtTorrentClient.dht;
	let indexTorrent = self.indexTorrentClient.torrents[0];
	let indexInfoHash = indexTorrent.infoHash;

	function processResult(res) {
		if(!res) {
			console.log('DHT entry not found');
		} else {
			if(res.v.indexInfoHash == indexInfoHash) {
				self.seq = res.seq;
			}
			if(res.seq > self.seq) {
				console.log('Index is out of date');
				self.seq = res.seq;
				return self.pull(res.v.indexInfoHash);
			} else {
				console.log('Index is up to date');
			}
		}
	}

	return Promise
		.try(() => console.log('> sync'))
		.then(() => getIndexMetadata(dht))
		.then(processResult)
		.then(() => self.push())
		// .finally(() => dhtTorrentClient.destroyAsync())
		.finally(() => console.log('< sync'));
};

PeerToPeerAdaptor.prototype.isReady = function() {
	var self = this;
	// console.log('>< isReady', self.index !== undefined);
	return self.index !== undefined;
};

PeerToPeerAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	var self = this;
	return self.localStorageAdaptor.getTiddlerInfo(tiddler);
};

/*
Get an array of skinny tiddler fields from the server
*/
PeerToPeerAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	let self = this;

	return Promise.resolve(self.mutex.runExclusive(() => Promise
		.try(() => console.log('> getSkinnyTiddlers', self.isReady()))
		.then(() => self.sync())
		.then(() => self.localStorageAdaptor.getSkinnyTiddlersAsync())
		.finally(() => console.log('< getSkinnyTiddlers'))
	)).asCallback(callback);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
PeerToPeerAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	let self = this;
	let tiddlerTitle = tiddler.fields.title;

	Promise
		.try(() => console.log("> saveTiddler", tiddlerTitle))
		// .then(() => self.sync())
		.then(() => self.localStorageAdaptor.saveTiddlerAsync(tiddler))
		.then(() => self.seedTiddler(tiddler))
		.then((tiddlerTorrent) => {
			self.index[tiddlerTitle] = tiddlerTorrent.infoHash;
		})
		.then(() => self.seedIndex())
		.then(() => self.push())
		.finally(() => {
			for(let t of self.tiddlersTorrentClient.torrents) {
				console.log(t.infoHash);
			}
		})
		.finally(() => console.log("< saveTiddler", tiddlerTitle))
		.asCallback(callback);
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)
*/
PeerToPeerAdaptor.prototype.loadTiddler = function(title,callback) {
	var self = this;
	self.localStorageAdaptor.loadTiddler(title, callback);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
PeerToPeerAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	var self = this;

	Promise.try(() => {
		console.log("> deleteTiddler", title);

		let tiddlerInfoHash = self.index[title];
		if(tiddlerInfoHash !== undefined) {
			console.log(tiddlerInfoHash);
			return self.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
				.then(() => delete self.index[title])
				.then(() => self.seedIndex())
				.then(() => self.push())
				.then(() => Promise.fromCallback(
					(callback) => self.localStorageAdaptor.deleteTiddler(title, callback, options)
				))
				.catch((e) => {
					console.log(e);
					// console.log(self.tiddlersTorrentClient.)
					console.log(self.index);
				});
		}
	})
	.finally(() => console.log("< deleteTiddler", title))
	.asCallback(callback);
};

if($tw.browser) {
	exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
}

})();
