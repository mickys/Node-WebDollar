const colors = require('colors/safe');
import NodesList from 'node/lists/nodes-list'
import InterfaceBlockchainProtocol from "./../protocol/Interface-Blockchain-Protocol"
import MiniBlockchainProtocol from "common/blockchain/mini-blockchain/protocol/Mini-Blockchain-Protocol"
import InterfaceBlockchainFork from 'common/blockchain/interface-blockchain/blockchain/forks/Interface-Blockchain-Fork'

/**
 *
 * Agent 47   - The place I was raised, they didn't give us names. They gave us numbers. Mine was 47.
 *
 *
 * An Agent is a class that force your machine to synchronize to the network based on the protocol you use it
 */

class InterfaceBlockchainAgent{

    constructor( blockchain, blockchainProtocolClass, blockchainForkClass){

        this.agentQueueProcessing = [];
        this.agentQueueCount = 0;

        this.AGENT_TIME_OUT = 10000;
        this.AGENT_QUEUE_COUNT_MAX = 2;
        this.NODES_LIST_MINIM_LENGTH = 2;

        this.blockchain = blockchain;
        if ( blockchainProtocolClass === undefined) blockchainProtocolClass = InterfaceBlockchainProtocol;

        this.protocol = new blockchainProtocolClass(this.blockchain);

        if ( blockchainForkClass === undefined ) blockchainForkClass = InterfaceBlockchainFork;
        this.forkClass = blockchainForkClass;
    }

    _initializeProtocol(){

        this.protocol.initialize(["acceptBlockHeaders"]);
    }

    async _requestBlockchainForNewPeer(result) {

        // let's ask everybody

        clearTimeout(this.startAgentTimeOut);
        this.startAgentTimeOut = undefined;

        try {

            let queueIndex = this.agentQueueProcessing.length-1;
            this.agentQueueProcessing.push(true);
            let answerBlockchain = await this.protocol.askBlockchain(result.socket);
            console.log("answerBlockchain");
            this.agentQueueProcessing.splice(queueIndex, 1);

        } catch (exception) {
            console.log(colors.red("Error asking for Blockchain"), exception);
        }

        result.socket.node.protocol.agent.startedAgentDone = true;
        this.agentQueueCount++;

        //check if start Agent is finished

        console.log("this.startAgentResolver",this.startAgentResolver !== undefined)
        console.log("this.agentQueueProcessing", this.agentQueueProcessing .length);
        if (this.startAgentResolver !== undefined && this.agentQueueProcessing.length === 0) {

            let done = true;
            for (let i = 0; i < NodesList.nodes.length; i++)
                if (NodesList.nodes[i].socket.level <= 3 && NodesList.nodes[i].socket.node.protocol.agent.startedAgentDone === false) {

                    done = false;
                    console.log("not done", NodesList.nodes[i]);
                    break;
                }

            //in case the agent is done and at least 4 nodes were tested
            if (done === true && this.startAgentResolver !== undefined &&
                NodesList.nodes.length >= this.NODES_LIST_MINIM_LENGTH && this.agentQueueCount >= this.AGENT_QUEUE_COUNT_MAX) {

                if (this.startAgentResolver === undefined) return;

                let resolver = this.startAgentResolver;
                this.startAgentResolver = undefined;

                console.log(colors.green("Synchronization done"));

                resolver({
                    result: true,
                    message: "Start Agent worked successfully",
                });

                return;
            }
        }

        //it is not done, maybe timeout
        this._setStartAgentTimeOut(0.5);
    }

    async _requestBlockchainForNewPeers(){

        this.agentQueueProcessing = [];
        this.agentQueueCount = 0;

        NodesList.emitter.on("nodes-list/connected", async (result) => { await this._requestBlockchainForNewPeer(result) } );

        NodesList.emitter.on("nodes-list/disconnected", (result) => {

        });


        for (let i=0; i<NodesList.nodes.length; i++)
            await this._requestBlockchainForNewPeer(NodesList.nodes[i]);

    }

    async initializeStartAgent(){

        this._initializeProtocol();

        this._startAgentPromise = new Promise((resolve)=>{
            console.log("initializeStartAgent() this.startAgentResolver")
            this.startAgentResolver = resolve;
        });


        this._setStartAgentTimeOut();

        await this._requestBlockchainForNewPeers();

    }

    startAgent(){
        console.log(colors.yellow("startAgent was started"));

        return this._startAgentPromise;
    }

    _setStartAgentTimeOut(factor=1){

        console.log("_setStartAgentTimeOut");

        if (this.startAgentTimeOut !== undefined) return;

        this.startAgentTimeOut = setTimeout( ()=>{

            if (this.startAgentResolver === undefined) return;

            let resolver = this.startAgentResolver;
            this.startAgentResolver = undefined;

            console.log( colors.green("Synchronization done FAILED") );

            this.startAgentTimeOut = undefined;

            resolver({
                result: false,
                message: "Start Agent Timeout",
            });

        }, this.AGENT_TIME_OUT*factor);
    }

    _setBlockchain(newBlockchain){

        this.blockchain = newBlockchain;
        this.protocol._setBlockchain(newBlockchain);
    }

}

export default InterfaceBlockchainAgent;