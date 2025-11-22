declare module 'ccxt' {
  export interface Exchange {
    id: string;
    name: string;
    options: any;
    markets: { [key: string]: any };
    constructor: any;
    loadMarkets(): Promise<any>;
    fetchTickers(): Promise<{ [key: string]: any }>;
  }

  export class binance implements Exchange {
    id: string;
    name: string;
    options: any;
    markets: { [key: string]: any };
    constructor(config?: any);
    loadMarkets(): Promise<any>;
    fetchTickers(): Promise<{ [key: string]: any }>;
  }

  export class bybit implements Exchange {
    id: string;
    name: string;
    options: any;
    markets: { [key: string]: any };
    constructor(config?: any);
    loadMarkets(): Promise<any>;
    fetchTickers(): Promise<{ [key: string]: any }>;
  }

  export class okx implements Exchange {
    id: string;
    name: string;
    options: any;
    markets: { [key: string]: any };
    constructor(config?: any);
    loadMarkets(): Promise<any>;
    fetchTickers(): Promise<{ [key: string]: any }>;
  }
}
