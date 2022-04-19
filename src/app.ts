import { AlphaRouter, AlphaRouterConfig, ChainId, CurrencyAmount, ID_TO_PROVIDER, ProtocolPoolSelection, SwapOptions, TokenProvider } from '@uniswap/smart-order-router';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Token, TradeType, Percent } from '@uniswap/sdk-core';
import { Protocol } from '@uniswap/router-sdk';

const protocol_pool_selection: ProtocolPoolSelection = {
    topN: 2,
    topNDirectSwaps: 2,
    topNTokenInOut: 3,
    topNSecondHop: 1,
    topNWithEachBaseToken: 3,
    topNWithBaseToken: 5,

};
const alpha_router_config: AlphaRouterConfig = {
    protocols: [Protocol.V3],
    v2PoolSelection: protocol_pool_selection,
    v3PoolSelection: protocol_pool_selection,
    maxSwapsPerPath: 3,
    maxSplits: 1,
    minSplits: 1,
    forceCrossProtocol: false,
    distributionPercent: 100,
};

const chain_id = ChainId.MAINNET;

const node_url = process.env.NODE_URL;
if (node_url === undefined) {
    console.log("need NODE_URL env variable");
    process.exit(1);
}
console.log("using node url", node_url);
const provider = new StaticJsonRpcProvider(node_url);
const network = await provider.getNetwork();
if (network.chainId !== chain_id) {
    console.log("node is not on mainnet");
    process.exit(1);
}

const router = new AlphaRouter({
    provider,
    chainId: chain_id,
});

interface Request {
    // "buy" or "sell"
    type: string,
    // address
    token_in: string,
    // address
    token_out: string,
    // integer atoms
    amount: string,
    // address
    recipient: string,
};

interface Response {
    // integer atoms
    quote: string;
    // integer
    gas: string,
    call_data: string,
    // integer ether atoms
    call_value: string,
};

async function parse_request(request: IncomingMessage): Promise<Request> {
    const buffers = [];
    for await (const chunk of request) {
        buffers.push(chunk);
    }
    const body: string = Buffer.concat(buffers).toString();
    // TODO: validate
    const request_: Request = JSON.parse(body);
    return request_;
}

async function handle_request(request: Request): Promise<Response> {
    // decimals don't matter because we want all amounts in atoms
    let token_in = new Token(chain_id, request.token_in, 0);
    let token_out = new Token(chain_id, request.token_out, 0);

    let amount: CurrencyAmount;
    let quote_currency: Token;
    let trade_type: TradeType;
    if (request.type === "sell") {
        amount = CurrencyAmount.fromRawAmount(token_in, request.amount);
        quote_currency = token_out;
        trade_type = TradeType.EXACT_INPUT;
    } else if (request.type === "buy") {
        amount = CurrencyAmount.fromRawAmount(token_out, request.amount);
        quote_currency = token_in;
        trade_type = TradeType.EXACT_OUTPUT;
    } else {
        throw "bad request type";
    }

    const swap_config: SwapOptions = {
        deadline: 4294967295,
        recipient: request.recipient,
        slippageTolerance: new Percent(5, 10_000),
    };
    let route = await router.route(
        amount, quote_currency, trade_type, swap_config,
    );
    if (route === null) {
        throw "no route";
    }
    if (route.methodParameters === undefined) {
        throw "no method parameters";
    }
    return {
        quote: route.quote.toExact(),
        gas: route.estimatedGasUsed.toString(),
        call_data: route.methodParameters.calldata,
        call_value: route.methodParameters.value,
    };
}

const server = createServer(
    async (req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/json');
        try {
            let request = await parse_request(req);
            let response = await handle_request(request);
            res.end(JSON.stringify(response));
        } catch (error) {
            console.error(error);
            res.end(JSON.stringify({ error: error }));
        }
    }
);

let host = process.env.HOST;
if (host === undefined) {
    host = "localhost"
}

const port_string = process.env.PORT;
let port;
if (port_string === undefined) {
    port = 8080;
} else {
    port = parseInt(port_string);
}

console.log("listening on", host, port);
server.listen(port, host);
