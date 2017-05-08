/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/

import * as Promise from "bluebird";
import { _ } from "underscore";
import * as WebTorrent from "webtorrent";
import { WebTorrentAsync, TorrentAsync } from "./webtorrent-async";
import { Mutex } from "async-mutex";

import crypto = require("crypto");
import ed = require("ed25519-supercop");

import "./webtorrent-async";

declare const $tw: any;

Promise.config({
	longStackTraces: true
});

function serializeTiddler(tiddler) {
	let data = _.mapObject(tiddler.fields,
		(value, key) => tiddler.getFieldString(key));
	return data;
}

class LocalStorageAdaptor {

	wiki: any;
	logger: any;

	constructor(options) {
		this.wiki = options.wiki;
		this.logger = new $tw.utils.Logger("LocalStorage");
	}

	name = "localstorage";

	isReady() {
		return true;
	};

	getTiddlerInfo(tiddler) {
		return {};
	};

	/*
	Get an array of skinny tiddler fields from the server
	*/
	getSkinnyTiddlers(callback) {
		let tiddlers = _(_.range(localStorage.length))
			.map((i) => JSON.parse(localStorage.getItem(localStorage.key(i))));
		console.log("getSkinnyTiddlers", tiddlers);
		callback(null, tiddlers);
	};

	getSkinnyTiddlersAsync: () => Promise<any[]>
	= Promise.promisify(this.getSkinnyTiddlers as (cb: (err: any, res: any[]) => void) => void);

	/*
	Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
	*/
	saveTiddler(tiddler, callback) {
		let tiddlerTitle = tiddler.fields.title;
		localStorage.setItem(tiddlerTitle, JSON.stringify(serializeTiddler(tiddler)));
		callback(null);
	};

	saveTiddlerAsync: (tiddler: any) => Promise<void>
	= Promise.promisify(this.saveTiddler as (tiddler: any, cb: (err: any, res: void) => void) => void);

	/*
	Load a tiddler and invoke the callback with (err,tiddlerFields)
	*/
	loadTiddler(title, callback) {
		// console.log("loadTiddler", title);
		let tiddler = JSON.parse(localStorage.getItem(title));
		callback(null, tiddler);
	};

	loadTiddlerAsync: (title: string) => Promise<any>
	= Promise.promisify(this.loadTiddler as (title: string, cb: (err: any, res: any) => void) => void);

	/*
	Delete a tiddler and invoke the callback with (err)
	*/
	deleteTiddler(title, callback, options) {
		console.log("deleteTiddler", title);
		localStorage.removeItem(title);
		callback(null);
	};

	deleteTiddlerAsync: (title: string) => Promise<void>
	= Promise.promisify(this.deleteTiddler as (title: string, cb: (err: any, res: void) => void) => void);
}

let keypair = require('./keypair.json')
let publicKey = keypair.publicKey;
let privateKey = keypair.secretKey;
let publicKeyBuf = new Buffer(publicKey, 'hex');
let privateKeyBuf = new Buffer(privateKey, 'hex');
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

	let magnetURI = `magnet:?xt=urn:btih:${indexInfoHash}&dn=index&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`;

	console.log('Adding torrent:', magnetURI);

	return Promise
		.try(() => torrentClient.addAsync(magnetURI))
		.then((indexTorrent) => {
			console.log('Torrent ready:', indexTorrent);
			Promise.promisifyAll(Object.getPrototypeOf(indexTorrent));
			indexTorrent.on('done', () => {
				console.log('Torrent done!');
			});
			return indexTorrent.onAsync('done')
				.then(() => extractJson(indexTorrent))
		})
		.finally(() => torrentClient.destroyAsync())
		.finally(() => console.log('< fetchIndex'));
}

function webTorrentClient(): WebTorrentAsync {
	let client = new WebTorrent({ dht: { verify: ed.verify } });
	Promise.promisifyAll((<any>client).dht);
	return <WebTorrentAsync><any>client;
}

function resetTorrentClient(client) {
	return Promise
		.map(client.torrents, (torrent) => client.removeAsync(torrent));
}

function addTiddlerTorrents(newIndex, tiddlersTorrentClient) {
	let indexDelta = _.pick(newIndex, (tiddlerInfoHash, tiddlerTitle) => {
		let oldTiddlerInfoHash = this.index[tiddlerTitle];
		return tiddlerInfoHash !== oldTiddlerInfoHash;
	});
	let tiddlersInfoHashes = _.values(indexDelta);
	return Promise.map(tiddlersInfoHashes, (tiddlerInfoHash) =>
		tiddlersTorrentClient.addAsync(tiddlerInfoHash));
}


function extractTiddlers(tiddlerTorrents: TorrentAsync[]) {
	return Promise
		.map(tiddlerTorrents,
		(tiddlerTorrent) => tiddlerTorrent.onAsync('done'))
		.then(() => Promise.map(tiddlerTorrents, extractJson));
}

function fetchTiddlers(newIndex, tiddlersTorrentClient, localStorageAdaptor) {
	return Promise
		.try(() => addTiddlerTorrents(newIndex, tiddlersTorrentClient))
		.then(extractTiddlers)
		.map((tiddler) => this.localStorageAdaptor.saveTiddlerAsync(tiddler));
}

class PeerToPeerAdaptor {
	ready: Boolean;
	wiki: any;
	logger: any;
	localStorageAdaptor: LocalStorageAdaptor;
	dhtTorrentClient: WebTorrentAsync;
	indexTorrentClient: WebTorrentAsync;
	tiddlersTorrentClient: WebTorrentAsync;
	seq = -1;
	mutex = new Mutex();
	index = undefined;

	constructor(options: any) {
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

	name = "p2p";

	seedTiddler(tiddlerFields): Promise<TorrentAsync> {
		console.log('Seeding tiddler:', tiddlerFields);
		let buffer = new Buffer(JSON.stringify(tiddlerFields));
		console.log(buffer.toString());

		let tiddlerTorrent = this.tiddlersTorrentClient.get(buffer);
		if (tiddlerTorrent) {
			return Promise.resolve(tiddlerTorrent);
		} else {
			return this.tiddlersTorrentClient.seedAsync(buffer, { name: 'tiddler' });
		}
	}

	initIndex() {
		console.log("> initIndex");

		let tiddlers = loadAllTiddlers(); // {title: tiddler}

		return this.mutex.runExclusive(() => Promise
			.map(_.values(tiddlers), (tiddlerFields) => this.seedTiddler(tiddlerFields))
			.map((tiddlerTorrent: TorrentAsync) => tiddlerTorrent.infoHash)
			.then((tiddlerTorrentsInfoHashes) => {
				console.log("Updating index...");
				this.index = _.object(_.keys(tiddlers), tiddlerTorrentsInfoHashes);
				console.log(this.index);
			})
			.then(() => this.seedIndex())
			.finally(() => console.log("< initIndex"))
		);
	};

	seedIndex() {
		return Promise
			.try(() => console.log("> seedIndex"))
			.then(() => resetTorrentClient(this.indexTorrentClient))
			.then(() => {
				let indexJsonBuf = new Buffer(JSON.stringify(this.index));
				console.log("Seeding index...");
				console.log(indexJsonBuf.toString());
				return this.indexTorrentClient.seedAsync(indexJsonBuf, { name: 'index' });
			})
			.then((torrent) => {
				console.log('Info hash:', torrent.infoHash);
				console.log('Magnet URI:')
				console.log(torrent.magnetURI);
			})
			// .then(() => this.push())
			.finally(() => console.log("< seedIndex"));
	};

	seedNewIndex(newIndex) {
		let newIndexBuffer = new Buffer(JSON.stringify(newIndex));

		return Promise
			.try(() => resetTorrentClient(this.indexTorrentClient))
			.then(() => this.indexTorrentClient.addAsync(
				newIndexBuffer, { name: 'index' }));
	}

	pull(indexInfoHash): Promise<void> {
		console.log('> pull');

		let i = fetchIndex(indexInfoHash);
		let t = i.then((newIndex) =>
			fetchTiddlers(
				newIndex,
				this.tiddlersTorrentClient,
				this.localStorageAdaptor))
		let s = i.then(this.seedNewIndex);
		return Promise
			.join(t, s, (a, b) => null)
			.finally(() => console.log('< pull'));
	}

	push() {
		console.log('> push');

		let dht = this.dhtTorrentClient.dht;
		let indexTorrent = this.indexTorrentClient.torrents[0];
		let indexInfoHash = indexTorrent.infoHash;

		return Promise
			.try(() => putIndexMetadata(dht, {
				indexInfoHash: new Buffer(indexInfoHash, 'hex')
			}, this.seq))
			.then(() => {
				this.seq = this.seq + 1;
			})
			.finally(() => console.log('< push'));;
	}


	sync() {
		// let dhtTorrentClient = webTorrentClient();
		let dht = this.dhtTorrentClient.dht;
		let indexTorrent = this.indexTorrentClient.torrents[0];
		let indexInfoHash = indexTorrent.infoHash;
		let self = this;

		function processResult(res) {
			if (!res) {
				console.log('DHT entry not found');
			} else {
				let resIndexInfoHash = res.v.indexInfoHash.toString('hex');
				console.log(resIndexInfoHash, indexInfoHash);
				if (resIndexInfoHash == indexInfoHash) {
					self.seq = res.seq;
				}
				if (res.seq > self.seq) {
					console.log('Index is out of date');
					self.seq = res.seq;
					return self.pull(resIndexInfoHash);
				} else {
					console.log('Index is up to date');
				}
			}
		}

		return Promise
			.try(() => console.log('> sync'))
			.then(() => getIndexMetadata(dht))
			.then(processResult)
			.then(() => this.push())
			// .finally(() => dhtTorrentClient.destroyAsync())
			.finally(() => console.log('< sync'));
	};

	isReady() {
		// console.log('>< isReady', this.index !== undefined);
		return this.index !== undefined;
	};

	getTiddlerInfo(tiddler) {
		return this.localStorageAdaptor.getTiddlerInfo(tiddler);
	};

	/*
	Get an array of skinny tiddler fields from the server
	*/
	getSkinnyTiddlers(callback) {
		return Promise.resolve(this.mutex.runExclusive(() => Promise
			.try(() => console.log('> getSkinnyTiddlers', this.isReady()))
			.then(() => this.sync())
			.then(() => this.localStorageAdaptor.getSkinnyTiddlersAsync())
			.finally(() => console.log('< getSkinnyTiddlers'))
		)).asCallback(callback);
	};

	/*
	Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
	*/
	saveTiddler(tiddler, callback) {
		let tiddlerTitle = tiddler.fields.title;
		let tiddlerFields = serializeTiddler(tiddler);

		Promise
			.try(() => console.log("> saveTiddler", tiddlerTitle))
			.then(() => this.localStorageAdaptor.loadTiddlerAsync(tiddlerTitle))
			.then((oldTiddlerFields) => {
				console.log(oldTiddlerFields, tiddlerFields);
				if (_.isEqual(oldTiddlerFields, tiddlerFields)) {
					console.log('Tiddler did not change');
					return;
				} else {
					return Promise
						.try(() =>
							this.localStorageAdaptor.saveTiddlerAsync(tiddler))
						.then(() => this.seedTiddler(tiddlerFields))
						.then((tiddlerTorrent) => {
							this.index[tiddlerTitle] = tiddlerTorrent.infoHash;
						})
						.then(() => this.seedIndex())
						.then(() => this.push())
						.finally(() => {
							for (let t of this.tiddlersTorrentClient.torrents) {
								console.log(t.infoHash);
							}
						});
				}
			})
			.finally(() => console.log("< saveTiddler", tiddlerTitle))
			.asCallback(callback);
	};

	/*
	Load a tiddler and invoke the callback with (err,tiddlerFields)
	*/
	loadTiddler(title, callback) {
		this.localStorageAdaptor.loadTiddler(title, callback);
	};

	/*
	Delete a tiddler and invoke the callback with (err)
	*/
	deleteTiddler(title, callback, options) {
		Promise
			.try(() => {
				console.log("> deleteTiddler", title);

				let tiddlerInfoHash = this.index[title];
				if (tiddlerInfoHash !== undefined) {
					console.log(tiddlerInfoHash);
					return this.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
						.then(() => delete this.index[title])
						.then(() => this.seedIndex())
						.then(() => this.push())
						.then(() => Promise.fromCallback(
							(callback) => this.localStorageAdaptor.deleteTiddler(title, callback, options)
						))
						.catch((e) => {
							console.log(e);
							// console.log(this.tiddlersTorrentClient.)
							console.log(this.index);
						});
				}
			})
			.finally(() => console.log("< deleteTiddler", title))
			.asCallback(callback);
	};

}

exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
