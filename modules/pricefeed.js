const Paprika = require('../providers/coinpaprika');
const paprika = new Paprika();
const Metals = require('../providers/metals');
const metals = new Metals();

class feeds {
    constructor(options) {
        this.options = options;
        this.assets = {};
        this.latestFeeds = {};
        this.latestFeedsMetal = {};
        this.assetsMetal = {};
    }

    // Assets Cer for BitShares v6.0.1+
    async getFixedCer(SYMBOL) {
        let fAsset = await this.options.BitSharesInstance.assets[SYMBOL];
        let oAsset =  await this.options.BitSharesInstance.db.get_objects([fAsset.bitasset_data_id]);
        let cer = 0;
        if (oAsset[0].settlement_price.base.amount > 0) {
            cer = (oAsset[0].settlement_price.base.amount / 10 ** fAsset.precision) / (oAsset[0].settlement_price.quote.amount / 10 ** 5);
        }
        return cer;
    }

    async init() {
        this.account = new this.options.BitSharesInstance(this.options.config.producer.name, this.options.config.producer.key);
        this.feeder = await this.options.BitSharesInstance.accounts[this.options.config.producer.name];
        console.log('init account', this.feeder.id, this.feeder.name);
    }

    async feelPrices() {
        this.assets[this.options.config.coreAsset] = (await this.options.BitSharesInstance.assets[this.options.config.coreAsset]);
        const feedAssets = Object.keys(this.options.config.priceFeeds.assets);
        this.latestFeeds = await paprika.getPrices();
        for (let i = 0; i < feedAssets.length; i++) {
            this.assets[feedAssets[i]] = (await this.options.BitSharesInstance.assets[feedAssets[i]]);
            let cer = await this.getFixedCer(feedAssets[i]);
            let cerFactor = (this.latestFeeds[feedAssets[i]].price + (this.latestFeeds[feedAssets[i]].price * 0.16)).toFixed(8) * 1;
            if (cer < this.latestFeeds[feedAssets[i]].price) {
                cer = cerFactor;
            }

            if (cer > 0) {
                this.latestFeeds[feedAssets[i]].cer = (cer).toFixed(8) * 1;
            } else {
                this.latestFeeds[feedAssets[i]].cer = cerFactor;
            }
        }
        return this.latestFeeds;
    }

    async publishAllFeeds() {
        console.log('-----------------------');
        await this.feelPrices();
        const feedAssets = Object.keys(this.options.config.priceFeeds.assets);
        let preparedTxs = [];

        for (let i = 0; i < feedAssets.length; i++) {
            if (this.latestFeeds[feedAssets[i]].cer > 0) {
                this.latestFeeds[feedAssets[i]].price = Math.floor(this.latestFeeds[feedAssets[i]].price * 10 ** this.assets[feedAssets[i]].precision) / 10 ** this.assets[feedAssets[i]].precision;
                //this.latestFeeds[feedAssets[i]].cer = Math.floor(this.latestFeeds[feedAssets[i]].cer * 10 ** this.assets[feedAssets[i]].precision) / 10 ** this.assets[feedAssets[i]].precision;
                let tx = this.account.newTx();
                try {
                    tx.asset_publish_feed(await this.publishPrice({
                        symbol: feedAssets[i],
                        price: this.latestFeeds[feedAssets[i]].price,
                        cer: this.latestFeeds[feedAssets[i]].cer
                    }));
                } catch (e) {
                    console.log('err publish', feedAssets[i]);
                }

                try {
                    await tx.broadcast();
                } catch(e) {
                    console.log('err tx', e)
                }
            }
        }

        //await this.publishMetalFeeds()

        return this.latestFeeds;
    }

    async publishPrice(options) {
        console.log('----------------------');
        console.log('symbol', options.symbol);
        console.log('id', this.assets[options.symbol].id);
        console.log('price', options.price);
        console.log('cer', options.cer);
        return ({
            "publisher": this.feeder.id,
            "asset_id": this.assets[options.symbol].id,
            "feed": {
                "settlement_price": {
                    "base": {
                        "amount": Math.round(options.price * 10 ** this.assets[options.symbol].precision),
                        "asset_id": this.assets[options.symbol].id
                    },
                    "quote": {
                        "amount": 10 ** this.assets[this.options.config.coreAsset].precision,
                        "asset_id": this.assets[this.options.config.coreAsset].id // 1.0.3
                    }
                },
                "maintenance_collateral_ratio": this.options.config.priceFeeds.assets[options.symbol].MCR * 1000,
                "maximum_short_squeeze_ratio": this.options.config.priceFeeds.assets[options.symbol].MSSR * 1000,
                "core_exchange_rate": {
                    "base": {
                        "amount": Math.round(options.cer * 10 ** this.assets[options.symbol].precision),
                        "asset_id": this.assets[options.symbol].id
                    },
                    "quote": {
                        "amount": 10 ** this.assets[this.options.config.coreAsset].precision,
                        "asset_id": this.assets[this.options.config.coreAsset].id // 1.0.3
                    }
                }
            }
        });
        //let tx = this.account.newTx();
        //tx.asset_publish_feed(params);
        //await tx.broadcast();
        //console.log('publish price', options.symbol);
    }

    /** GOLD, SILVER ETC METAL FEEDS **/

    async feelPricesMetal() {
        const feedAssets = Object.keys(this.options.config.priceFeeds.assetsMetal);
        this.latestFeedsMetal = await metals.getPrices(this.latestFeeds['USD'].price);
        for (let i = 0; i < feedAssets.length; i++) {
            this.assetsMetal[feedAssets[i]] = (await this.options.BitSharesInstance.assets[feedAssets[i]]);
        }
        return this.latestFeedsMetal;
    }

    async publishPriceMetal(options) {
        console.log('id', this.assetsMetal[options.symbol].id);
        let params = {
            "publisher": this.feeder.id,
            "asset_id": this.assetsMetal[options.symbol].id,
            "feed": {
                "settlement_price": {
                    "base": {
                        "amount": Math.round(options.price * 10 ** this.assetsMetal[options.symbol].precision),
                        "asset_id": this.assetsMetal[options.symbol].id
                    },
                    "quote": {
                        "amount": 10 ** this.assets[this.options.config.coreAsset].precision,
                        "asset_id": this.assets[this.options.config.coreAsset].id // 1.0.3
                    }
                },
                "maintenance_collateral_ratio": this.options.config.priceFeeds.assetsMetal[options.symbol].MCR * 1000,
                "maximum_short_squeeze_ratio": this.options.config.priceFeeds.assetsMetal[options.symbol].MSSR * 1000,
                "core_exchange_rate": {
                    "base": {
                        "amount": Math.round(options.cer * 10 ** this.assetsMetal[options.symbol].precision),
                        "asset_id": this.assetsMetal[options.symbol].id
                    },
                    "quote": {
                        "amount": 10 ** this.assets[this.options.config.coreAsset].precision,
                        "asset_id": this.assets[this.options.config.coreAsset].id // 1.0.3
                    }
                }
            }
        };

        let tx = this.account.newTx();
        tx.asset_publish_feed(params);
        await tx.broadcast();
        console.log('publish price metal', options.symbol);
    }

    async publishMetalFeeds() {
        console.log('-----------------------');
        await this.feelPricesMetal();
        const feedAssets = Object.keys(this.options.config.priceFeeds.assetsMetal);
        console.log(feedAssets, this.latestFeedsMetal);

        for (let i = 0; i < feedAssets.length; i++) {
            if (this.latestFeedsMetal[feedAssets[i]].cer > 0) {
                try {
                    await this.publishPriceMetal({
                        symbol: feedAssets[i],
                        price: this.latestFeedsMetal[feedAssets[i]].price,
                        cer: this.latestFeedsMetal[feedAssets[i]].cer
                    });
                } catch(e) {
                    console.log(e);
                    console.log('err publish', feedAssets[i]);
                }
            }
        }
        return this.latestFeedsMetal;
    }


}

module.exports = feeds;
