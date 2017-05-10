import * as Promise from "bluebird";

import * as WebTorrent from "webtorrent";
import { Torrent, TorrentOptions, TorrentFile } from "webtorrent";

import { Instance as ParseTorrent } from 'parse-torrent';
import { Instance as SimplePeer } from 'simple-peer';
import { RequestOptions, Server } from 'http';
import { Wire } from 'bittorrent-protocol';

export interface WebTorrentAsync extends WebTorrent.Instance {
    dht: any;

    get(torrentId: Torrent | string | Buffer): TorrentAsync;
    addAsync(torrent: string | Buffer | ParseTorrent): Promise<TorrentAsync>;
    addAsync(torrent: string | Buffer | ParseTorrent, opts?: TorrentOptions): Promise<TorrentAsync>;
    seedAsync(input: string | string[] | File | File[] | FileList | Buffer | Buffer[] | NodeJS.ReadableStream | NodeJS.ReadableStream[], opts?: TorrentOptions): Promise<TorrentAsync>;
    seedAsync(input: string | string[] | File | File[] | FileList | Buffer | Buffer[] | NodeJS.ReadableStream | NodeJS.ReadableStream[]): Promise<TorrentAsync>;
    removeAsync(torrentId: Torrent | string | Buffer): Promise<void>;
    destroyAsync(): Promise<void>;

}

export interface TorrentAsync extends WebTorrent.Torrent {
    onAsync(event: 'infoHash' | 'metadata' | 'ready' | 'done'): Promise<void>;
}

export interface TorrentFileAsync extends WebTorrent.TorrentFile {
    getBufferAsync(): Promise<Buffer>;
}

export function async(file: TorrentFile): TorrentFileAsync {
    Promise.promisifyAll(file);
    return <TorrentFileAsync> file;
}

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

Promise.promisifyAll(WebTorrent.prototype);
WebTorrent.prototype.addAsync = noErrPromisifier(WebTorrent.prototype.add);
WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);	
