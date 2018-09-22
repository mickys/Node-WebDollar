const EventEmitter = require('events');
import StatusEvents from "common/events/Status-Events";

import consts from 'consts/const_global'
import InterfaceSatoshminDB from 'common/satoshmindb/Interface-SatoshminDB';
import Log from 'common/utils/logging/Log';
import NodesList from 'node/lists/Nodes-List'
import InterfaceBlockchainAddressHelper from "common/blockchain/interface-blockchain/addresses/Interface-Blockchain-Address-Helper";
import WebDollarCrypto from "common/crypto/WebDollar-Crypto";
const axios = require('axios');

class PoolStatistics{

    constructor(poolManagement, databaseName){

        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100);

        this.poolManagement = poolManagement;

        this.POOL_STATISTICS_TIME = 30000;
        this.POOL_STATISTICS_MEAN_VALUES = 10;
        this.POOL_MAX_IDLE_TIME = 600;

        this.poolHashes = 0;
        this.poolHashesReported = 0;

        this.poolHashesNow = 0;

        this.poolMinersOnline = this.poolManagement.poolData.connectedMinerInstances.list;

        this.poolBlocksConfirmedAndPaid = 0;
        this.poolBlocksUnconfirmed = 0;
        this.poolBlocksConfirmed = 0;
        this.poolBlocksBeingConfirmed = 0;
        this.poolTimeRemaining = 0;

        this._db = new InterfaceSatoshminDB( databaseName ? databaseName : consts.DATABASE_NAMES.SERVER_POOL_DATABASE );

        //calculate mean
        this._poolHashesLast = [];

        this.minerStatistics = {};
    }

    initializePoolStatistics(){

        return  this._load();

    }

    startInterval(){
        this._interval = setInterval( this._poolStatisticsInterval.bind(this), this.POOL_STATISTICS_TIME );
        this._saveInterval = setInterval( this._save.bind(this), 5*this.POOL_STATISTICS_TIME);
        this._saveMinersInterval = setInterval( this._saveMiners.bind(this), this.POOL_STATISTICS_TIME);

    }

    clearInterval(){
        clearInterval(this._interval);
        clearInterval(this._saveInterval);
    }

    _poolStatisticsInterval(){

        let poolHashes = 0;
        let poolHashesReported = 0;
        const keys = Object.keys(this.minerStatistics);
        for( const key in keys) {
            if(this.minerStatistics[keys[key]]) {
                const miner = this.minerStatistics[keys[key]];
                poolHashes += miner.hashes_store_avg;
                poolHashesReported += miner.hashes_reported_avg;
            }
        }

        this.poolHashes = Math.floor(poolHashes);
        this.poolHashesReported = Math.floor(poolHashesReported);

        const updateObject = { poolHashes: this.poolHashes,
            poolHashesReported: this.poolHashesReported,
            poolMinersOnline: keys.length,
            poolBeingConfirmed: this.poolBlocksBeingConfirmed,
            poolBlocksConfirmed: this.poolBlocksConfirmed,
            poolBlocksConfirmedAndPaid: this.poolBlocksConfirmedAndPaid,
            poolBlocksUnconfirmed: this.poolBlocksUnconfirmed,
            poolTimeRemaining: this.poolTimeRemaining,
        };

        StatusEvents.emit("pools/statistics/update", updateObject);

        console.warn("poolStatisticsInterval Pool Hashes:", this.poolHashes);
    }


    addStatistics(hashes, work, minerInstance) {
        // console.warn("addStatistics: ", hashes.toNumber());
        this.includeMinerIntoStatistics(hashes.toNumber(), work, minerInstance);
    }



    includeMinerIntoStatistics(_hashes, work, minerInstance) {

        const hashes = Math.floor(_hashes);
        let included = false;

        const now = Math.round(new Date().getTime()/1000);
        const minerName = work.minerName || "not_set";
        const reportedHashrate = work.reportedHashrate || 0;
        const minerAddress = minerInstance.miner.address.toString("hex");
        const blockHeight = minerInstance.lastWork.h;
        // lets build a statistics key based on address and name.
        // using address and name allows our miners to configure their miner views as they please
        // basically someone that has multiple rigs can do
        // a) name each one and keep statistics for each
        // b) use the same name and combine all into one big record
        const namePart = Buffer.from(WebDollarCrypto.MD5(minerName)).toString("hex");
        const key =  namePart + "_" + minerAddress;

        if (this.minerStatistics[key] === undefined ) {

            // console.info("New Miner:");

            this.minerStatistics[key] = {
                minerName: minerName,
                minerWallet: InterfaceBlockchainAddressHelper.generateAddressWIF( minerInstance.miner.address, false, true ),
                totalhashes: hashes,
                hashes_last: hashes,
                hashes_avg: 0,
                first_action_timestamp: now,
                last_action_timestamp: now,
                hashes_store: [{
                    num: hashes,
                    time: now,
                    block: blockHeight,
                    reported_hashrate: reportedHashrate,
                }],
                hashes_store_avg: 0,
            };

            included = true;

        } else {

            const stats = this.minerStatistics[key];

            // sometimes, block validation triggers this twice, make sure to only add it once as we don't want duplicates.
            if( this.hashesInStats( stats.hashes_store, hashes ) ) {


                // console.info("Miner stats.hashes_store has hash", hashes);
                // console.error( key, "already has hashes", hashes, "included. skipping..." );
                included = false;

            } else {

                // console.info("Miner stats.hashes_store new hash", hashes);

                stats.hashes_last = hashes;
                stats.totalhashes += hashes;
                stats.last_action_timestamp = now;

                if (stats.hashes_store.length === this.POOL_STATISTICS_MEAN_VALUES ) {
                    // remove the first item
                    stats.hashes_store.shift();
                }
                // add current hashes in the last position
                stats.hashes_store.push({
                    num: hashes,
                    time: now,
                    block: blockHeight,
                    reported_hashrate: reportedHashrate,
                });

                included = true;
            }
        }

        if(included) {
            const stats = this.minerStatistics[key];
            const store = stats.hashes_store;
            // re calc avg
            const diff = stats.last_action_timestamp - stats.first_action_timestamp;
            stats.hashes_avg = stats.totalhashes / diff;

            let totals = 0;
            let totalReported = 0;
            for(const key in stats.hashes_store) {
                if(stats.hashes_store[key]) {
                    totals += stats.hashes_store[key].num;
                    totalReported += stats.hashes_store[key].reported_hashrate;
                }
            }

            //  console.error("totals: ", totals);

            // set store mean value
            let storediff = store[store.length-1].time - store[0].time;
            if (storediff === 0) { storediff = 1};
            stats.hashes_store_avg = ( totals / store.length ) / storediff;
            stats.hashes_store_time = storediff;
            stats.hashes_reported_avg = ( totalReported / store.length );
        }

        // console.info( this.minerStatistics[key] );
        // console.log( "height:", minerInstance.lastWork.h );

        return included;
    }

    hashesInStats(array, elm) {

        for(let key in array) {
            if( array[key].num === elm ) {
                return true;
            }
        }
        return false;
    }

    removeStaleMinerStats() {
        const now = Math.round(new Date().getTime()/1000);
        Log.info('Cleaning up minerStatistics so we don\'t use too much memory. ( Idle time setting: '+this.POOL_MAX_IDLE_TIME+')', Log.LOG_TYPE.POOLS);

        let removed = 0;
        const keys = Object.keys(this.minerStatistics);
        for( const key in keys) {
            if(this.minerStatistics[keys[key]]) {
                const idleTime = now - this.minerStatistics[keys[key]].last_action_timestamp;
                if( idleTime > this.POOL_MAX_IDLE_TIME ) {
                    const miner = this.minerStatistics[keys[key]];
                    // Log.info('Miner name: '+miner.minerName+' Wallet: '+miner.minerWallet+" removed due to timeout.", Log.LOG_TYPE.POOLS);
                    // remove key
                    delete this.minerStatistics[keys[key]];
                    removed++;
                }
            }
        }

        Log.info('Removed instances: '+removed, Log.LOG_TYPE.POOLS);
    }

    serializeMiners() {
        const data = [];

        const keys = Object.keys(this.minerStatistics);
        for(const key in keys) {
            if(this.minerStatistics[keys[key]]) {
                data.push( JSON.stringify(this.minerStatistics[keys[key]]) );
            }
        }
        return data;
    }

    async _saveMiners(){

        // save a snapshot of current miners that provided any work.
        const statsServerUrl = "http://stats.nowlive.ro/api/addStatistics";

        const payload = {
            minerList: this.serializeMiners(),
        };

        await axios.post(statsServerUrl, payload, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } );

        Log.info('Sent miner statistics to stats server at: '+statsServerUrl, Log.LOG_TYPE.POOLS);

        // free memory: remove stale miner records
        this.removeStaleMinerStats();
    }

    async _save(){

        Log.info('Saving pool statistics...', Log.LOG_TYPE.POOLS);
        await this._db.save("serverPool_statistics_confirmedAndPaid", this.poolBlocksConfirmedAndPaid );
        await this._db.save("serverPool_statistics_unconfirmed", this.poolBlocksUnconfirmed);

    }

    async _load(){

        Log.info('Loading pool statistics...', Log.LOG_TYPE.POOLS);
        let confirmedAndPaid = await this._db.get("serverPool_statistics_confirmedAndPaid", 30*1000, true);
        let unconfirmed = await this._db.get("serverPool_statistics_unconfirmed", 30*1000, true);

        if (typeof confirmedAndPaid !== "number") confirmedAndPaid = 0;
        if (typeof unconfirmed !== "number") unconfirmed = 0;

        this.poolBlocksConfirmedAndPaid = confirmedAndPaid;
        this.poolBlocksUnconfirmed = unconfirmed;

        return true;
    }

    async _clear(){

        Log.info('Clearing pool statistics...', Log.LOG_TYPE.POOLS);
        try {
            return (await this._db.remove("serverPool_statistics_confirmedAndPaid"));
        }
        catch(exception) {
            console.log('Exception on clear serverPool_statistics_confirmedAndPaid: ', exception);
            return false;
        }
    }

}

export default PoolStatistics;
