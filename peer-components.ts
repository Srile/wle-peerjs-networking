import {Component, Material, Mesh, MeshComponent, Object3D, TextComponent, Type} from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';
import type { DataConnection, MediaConnection, Peer as PeerType } from 'peerjs';
export let isHost = false;

interface PeerConstructor {
    new (id?:string|null): PeerType;
}

let Peer: PeerConstructor|null = null;

const tempTransform = new Float32Array(8);
const tempVec: Float32Array = new Float32Array(3);

interface PlayerTransforms {
    head: Float32Array;
    rightHand: Float32Array;
    leftHand: Float32Array;
}

interface DataPackage {
    transforms?: PlayerTransforms;
    joinedPlayers?: string[];
}

export class PeerManager extends Component {
    static TypeName = 'peer-manager';

    streams: {[propKey: string]: MediaStream} = {};
    activePlayers: {[propKey: string]: PeerNetworkedPlayer|null} = {};

    currentDataPackage: DataPackage & {[propKey: string]: any} = {};
    calls: {[propKey: string]: MediaConnection} = {};
    connections: DataConnection[] = [];
    currentTime: number = 0.0;

    // Dual quaternions for sending head, left and right hand transforms
    headDualQuat: Float32Array = new Float32Array(8);
    rightHandDualQuat: Float32Array = new Float32Array(8);
    leftHandDualQuat: Float32Array = new Float32Array(8);

    // Records user audio
    audio: HTMLAudioElement|null = null;

    localStream?: MediaStream;
    
    connectionEstablishedCallbacks: (() => void)[] = [];
    clientJoinedCallbacks: ((peer: string, player: PeerNetworkedPlayer) => void)[] = [];
    disconnectCallbacks: (() => void)[] = [];
    registeredNetworkCallbacks: {[propKey: string]: ((data: any) => void)} = {};

    networkPlayerSpawner: PeerNetworkedPlayerPool|PeerNetworkedPlayerSpawner|null = null;

    peer: PeerType|null = null;

    connection?: DataConnection|null = null;

    connectionId: string|null = null

    /* Properties */
    @property.string('THISISAWONDERLANDENGINEPLACEHOLDER')
    serverId: string = 'THISISAWONDERLANDENGINEPLACEHOLDER';
     
    @property.float(0.01)
    networkSendFrequencyInS: number = 0.01;

    @property.object()
    playerHead: Object3D|null = null;
    
    @property.object()
    playerRightHand: Object3D|null = null;

    @property.object()
    playerLeftHand: Object3D|null = null;

    @property.object()
    networkPlayerPool: Object3D|null = null;

    @property.bool(true)
    voiceEnabled: boolean = true;

    init() {
        /* We need to require() peerjs, since it uses 'navigator' in the
         * global scope, which isn't available when Wonderland Editor evaluates
         * the bundle for finding components */
        Peer = require('peerjs').Peer;
        
        this.audio = document.createElement('audio');
        this.audio.id = 'localAudio';
        document.body.appendChild(this.audio);

        navigator.mediaDevices
            .getUserMedia({audio: true, video: false})
            .then((stream) => {
                this.localStream = stream;
            })
            .catch((err) => console.error('User denied audio access.', err));
    }

    start() {
        if(!this.networkPlayerPool) throw new Error('networkPlayerPool was not set');
        
        /* Try to get one of the two types of spawner component */
        this.networkPlayerSpawner =
            this.networkPlayerPool.getComponent(PeerNetworkedPlayerPool) ||
            this.networkPlayerPool.getComponent(PeerNetworkedPlayerSpawner);
    }

    //
    // Host functions
    //
    host() {
        if(!Peer) throw new Error('Peer object not found');

        this.peer = new Peer(this.serverId);
        this.peer.on('open', this._onHostOpen.bind(this));
        this.peer.on('connection', this._onHostConnected.bind(this));
        this.peer.on('disconnected', this._onDisconnected.bind(this));

        this.peer.on('call', (call: MediaConnection) => {
            this.calls[call.peer] = call;
            call.answer(this.localStream);
            call.on('stream', (stream) => {
                const audio = document.createElement('audio');
                audio.id = 'remoteAudio' + call.peer;
                document.body.appendChild(audio);
                audio.srcObject = stream;
                audio.autoplay = true;
                this.streams[call.peer] = stream;
            });
        });
    }

    kick(id: string) {
        this.currentDataPackage['disconnect'] = this.currentDataPackage['disconnect'] || [];
        this.currentDataPackage['disconnect'].push(id);
        this._removePlayer(id);
    }

    _onHostOpen(id: string) {
        isHost = true;
        this.serverId = id;
        this.activePlayers[this.serverId] = null;
        for (const cb of this.connectionEstablishedCallbacks) cb();
    }

    _onHostConnected(connection: DataConnection) {
        this._hostPlayerJoined(connection.peer, connection.metadata.username);
        this.connections.push(connection);
        connection.on('open', () => {
            // Additional data too be sent on joining can be added here
            connection.send({
                joinedPlayers: Object.keys(this.activePlayers),
                joined: true,
            });
        });
        connection.on('close', () => this._onHostConnectionClose(connection));
        connection.on('data', (data) => this._onHostDataReceived(data, connection));
        this.object.setTranslationWorld([0, 0, 0]);
    }

    _onHostDataReceived(data: any, connection: DataConnection) {
        const activePlayer = this.activePlayers[connection.peer];
        if (data.transforms && activePlayer) {
            activePlayer.setTransforms(data.transforms);
        }

        for (const key of Object.keys(data)) {
            if (key == 'transforms') continue;
            if (this.registeredNetworkCallbacks[key]) {
                this.registeredNetworkCallbacks[key](data[key]);
            }
        }
        this.currentDataPackage[connection.peer] = data;
    }

    _onHostConnectionClose(connection: DataConnection) {
        this._removePlayer(connection.peer);
        this.object.setTranslationWorld([0, -1, 0]);
        this.disconnect();

        this.currentDataPackage['disconnect'] = this.currentDataPackage['disconnect'] || [];
        this.currentDataPackage['disconnect'].push(connection.peer);
    }

    _hostPlayerJoined(id: string, username: string) {
        if(!this.networkPlayerSpawner) throw new Error('networkPlayerSpawner is not set');
        let newPlayer = this.networkPlayerSpawner.getEntity(username);
        if(!newPlayer) throw new Error('Could not spawn player');
        this.activePlayers[id] = newPlayer;
        this.currentDataPackage.joinedPlayers = this.currentDataPackage.joinedPlayers || [];
        this.currentDataPackage.joinedPlayers.push(id);

        for (const cb of this.clientJoinedCallbacks) cb(id, newPlayer);
    }

    //
    // Client functions
    //
    join() {
        this.connect(this.serverId);
    }

    connect(id: string) {
        if(!Peer) throw new Error('Peer object not found');
        if (!id) return console.error('peer-manager: Connection id parameter missing');
        // Already initialized?
        if (this.peer) return;

        this.peer = new Peer();
        this.peer.on('open', this._clientOnOpen.bind(this));
        this.peer.on('disconnected', this._onDisconnected.bind(this));

        this.connectionId = id;

        this.peer.on('call', (call) => {
            if (!this.voiceEnabled) return;

            this.calls[call.peer] = call;
            call.answer(this.localStream);
            call.on('stream', (stream) => {
                const audio = document.createElement('audio');
                audio.id = 'remoteAudio' + id;
                document.body.appendChild(audio);
                audio.srcObject = stream;
                audio.autoplay = true;
                this.streams[id] = stream;
            });
        });
    }

    disconnect() {
        if (!this.peer) return;

        this.peer.destroy();
        this.peer = null;
        this.connections = [];
        delete this.connection;
    }

    _onClientConnected() {
        this.call(this.serverId);
        isHost = false;
        for (const cb of this.connectionEstablishedCallbacks) cb();
    }

    _onClientDataReceived(data: any) {
        const registeredCallbacksKeys = Object.keys(this.registeredNetworkCallbacks);
        const joined = 'joined' in data;

        for (const key of Object.keys(data)) {
            const value = data[key];
            if (key == 'joinedPlayers') {
                for (let j = 0; j < data.joinedPlayers.length; j++) {
                    const p = data.joinedPlayers[j];
                    // if the join id is the same, ignore
                    if (p == this.peer!.id || this.activePlayers[p]) continue;
                    if (!joined && p != this.serverId) {
                        setTimeout(() => {
                            this.call(p);
                        }, Math.floor(500 * j));
                    }
                    // TODO: Relay name from host to other players within joinedPlayers
                    const newPlayer = this.networkPlayerSpawner?.getEntity("dummy");
                    if(!newPlayer) throw new Error("Could not spawn player");
                    this.activePlayers[p] = newPlayer;
                    for (const cb of this.clientJoinedCallbacks) cb(p, newPlayer);
                }
                continue;
            }

            if (key == 'call') continue;
            if (key == 'disconnect') {
                for (const v of value) this._removePlayer(v);
            }

            const activePlayer = this.activePlayers[key];
            if (activePlayer) {
                const values = Object.keys(value);
                for (const v of values) {
                    if (v == 'transforms') {
                        activePlayer.setTransforms(value.transforms);
                        continue;
                    }

                    let includes = registeredCallbacksKeys.includes(v);
                    if (includes) this.registeredNetworkCallbacks[v](value[v]);
                }
                continue;
            }

            let includes = registeredCallbacksKeys.includes(key);
            if (includes) this.registeredNetworkCallbacks[key](value);
        }
    }

    _removeAllPlayers() {
        const players = Object.keys(this.activePlayers);
        for (const player of players) this._removePlayer(player);
    }

    _removePlayer(peerId: string) {
        if (!this.activePlayers[peerId]) return;

        if (this.calls[peerId]) {
            this.calls[peerId].close();
            delete this.calls[peerId];
        }

        if (this.connections.length) {
            const con = this.connections.find((element) => {
                return element.peer === peerId;
            });
            if (con) {
                con.close();
                let index = this.connections.indexOf(con);
                if (index > -1) this.connections.splice(index, 1);
            }
        }

        const activePlayer = this.activePlayers[peerId];
        if (activePlayer) {
            activePlayer.reset();
            this.networkPlayerSpawner?.returnEntity(activePlayer);
        }
        delete this.activePlayers[peerId];
    }

    // All functions
    _onDisconnected() {
        this._removeAllPlayers();
        this.disconnect();
        for (let cb of this.disconnectCallbacks) cb();
    }

    call(id: string) {
        if (!this.voiceEnabled) return;

        if (!this.localStream) {
            /* If the page doesn't have permission to access
             * audio stream, creation of the call would fail */
            console.error('Cannot call: no audio stream');
            return;
        }
        if (!this.peer) {
            console.error('Cannot call: no peer connection');
            return;
        }
        const call = this.peer.call(id, this.localStream);
        this.calls[id] = call;
        call.on('stream', (stream) => {
            const audio = document.createElement('audio');
            audio.id = id;
            document.body.appendChild(audio);
            audio.srcObject = stream;
            audio.autoplay = true;
            this.streams[id] = stream;
        });
    }

    _clientOnOpen() {
        if(!this.connectionId) throw new Error('connectionId not set');
        if(!this.peer) throw new Error('No peer connection');

        this.connection = this.peer.connect(this.connectionId, {
            // reliable: true,
            metadata: {username: 'TestName'},
        });
        this.connection.on('open', this._onClientConnected.bind(this));
        this.connection.on('data', this._onClientDataReceived.bind(this));
        this.connection.on('close', this._onClientClose.bind(this));
    }

    _onClientClose() {
        if (this.peer) this.peer.destroy();
    }

    addConnectionEstablishedCallback(f: () => void) {
        this.connectionEstablishedCallbacks = this.connectionEstablishedCallbacks || [];
        this.connectionEstablishedCallbacks.push(f);
    }

    removeConnectionEstablishedCallback(f: () => void) {
        const index = this.connectionEstablishedCallbacks.indexOf(f);
        if (index <= -1) return;

        this.connectionEstablishedCallbacks.splice(index, 1);
    }

    addClientJoinedCallback(f: () => void) {
        this.clientJoinedCallbacks = this.clientJoinedCallbacks || [];
        this.clientJoinedCallbacks.push(f);
    }

    removeClientJoinedCallback(f: () => void) {
        const index = this.clientJoinedCallbacks.indexOf(f);
        if (index <= -1) return;

        this.clientJoinedCallbacks.splice(index, 1);
    }

    addDisconnectCallback(f: () => void) {
        this.disconnectCallbacks = this.disconnectCallbacks || [];
        this.disconnectCallbacks.push(f);
    }

    removeDisconnectCallback(f: () => void) {
        const index = this.disconnectCallbacks.indexOf(f);
        if (index <= -1) return;

        this.disconnectCallbacks.splice(index, 1);
    }

    /* @deprecated Function was renamed to correct spelling */
    addNetworkDataRecievedCallback(key: string, f: () => void) {
        return this.addNetworkDataReceivedCallback(key, f);
    }

    addNetworkDataReceivedCallback(key: string, f: () => void) {
        this.registeredNetworkCallbacks = this.registeredNetworkCallbacks || {};
        this.registeredNetworkCallbacks[key] = f;
    }

    /* @deprecated Function was renamed to correct spelling */
    removeNetworkDataRecievedCallback(key: string) {
        return this.removeNetworkDataReceivedCallback(key);
    }

    removeNetworkDataReceivedCallback(key: string) {
        delete this.registeredNetworkCallbacks[key];
    }

    sendPackage(key: string, data: any) {
        this.currentDataPackage[key] = data;
    }

    sendPackageImmediately(key: string, data: any) {
        let p: any = {};
        p[key] = data;

        if (this.connection) {
            this.connection.send(p);
            return;
        }

        for (let con of this.connections) con.send(p);
    }

    toggleMute() {
        if(!this.localStream) return;
        this.localStream.getTracks()[0].enabled = !this.localStream.getTracks()[0].enabled;
    }

    setOwnMute(mute: boolean) {
        if(!this.localStream) return;
        this.localStream.getTracks()[0].enabled = !mute;
    }

    setOtherMute(id: string, mute: boolean) {
        if (this.streams[id]) this.streams[id].getTracks()[0].enabled = !mute;
    }

    updateTransforms() {
        if(this.playerHead) this.headDualQuat.set(this.playerHead.getTransformWorld(tempTransform));
        if(this.playerRightHand) this.rightHandDualQuat.set(this.playerRightHand.getTransformWorld(tempTransform));
        if(this.playerLeftHand) this.leftHandDualQuat.set(this.playerLeftHand.getTransformWorld(tempTransform));

    }

    update(dt: number) {
        if (!this.connection && this.connections.length == 0) return;

        this.currentTime += dt;
        if (this.currentTime < this.networkSendFrequencyInS) return;

        this.currentTime = 0.0;
        
        this.updateTransforms();

        if (this.connections.length) {
            this.currentDataPackage[this.serverId] = {
                transforms: {
                    head: this.headDualQuat,
                    rightHand: this.rightHandDualQuat,
                    leftHand: this.leftHandDualQuat,
                },
            };

            if (Object.keys(this.currentDataPackage).length == 0) return;

            for (let con of this.connections) {
                const currentConnectionId = con.peer;
                const pkg = Object.fromEntries(
                    Object.entries(this.currentDataPackage).filter((e) => {
                        return e[0] != currentConnectionId;
                    })
                );
                if (Object.keys(pkg).length) con.send(pkg);
            }
        } else if(this.connection) {
            this.currentDataPackage.transforms = {
                head: this.headDualQuat,
                rightHand: this.rightHandDualQuat,
                leftHand: this.leftHandDualQuat,
            };

            this.connection.send(this.currentDataPackage);
        }

        this.currentDataPackage = {};
    }
}

export class PeerNetworkedPlayerPool extends Component {
    static TypeName = 'peer-networked-player-pool';
    static Properties = {};

    inactivePool: PeerNetworkedPlayer[] = [];

    init() {
        for (let c of this.object.children) {
            const component = c.getComponent(PeerNetworkedPlayer);
            if(component) this.inactivePool.push(component);
        }
    }

    getEntity(username?: string) {
        if (this.inactivePool.length) {
            const component = this.inactivePool.shift();
            if(!component) throw new Error('PeerNetworkedPlayerPool contained object without PeerNetworkedPlayer component');
            if(username) component.setName(username);
            return component;
        }
        console.error('peer-networked-player-pool: No more inactive entities');
        return null;
    }

    returnEntity(entity: PeerNetworkedPlayer) {
        this.inactivePool.push(entity);
    }
}

export class PeerNetworkedPlayer extends Component {
    static TypeName = 'peer-networked-player';
    
    @property.object()
    head: Object3D|null = null;
    nameTextObject: Object3D|null = null;
    
    leftHand: Object3D|null = null;
    rightHand: Object3D|null = null;


    init() {
        for (let c of this.object.children) {
            if (c.name == 'Head') this.head = c;
            if (c.name == 'LeftHand') this.leftHand = c;
            if (c.name == 'RightHand') this.rightHand = c;
        }
    }

    setName(name: string) {
        if (!this.nameTextObject) return;
        const textComponent = this.nameTextObject.getComponent(TextComponent);
        if(textComponent) textComponent.text = name;
    }

    reset() {
        this.head?.resetTranslationRotation();
        this.rightHand?.resetTranslationRotation();
        this.leftHand?.resetTranslationRotation();
    }

    setTransforms(transforms: PlayerTransforms) {
        tempTransform.set(transforms.head)
        this.head?.setTransformLocal(tempTransform);
        tempTransform.set(transforms.rightHand)
        this.rightHand?.setTransformLocal(tempTransform);
        tempTransform.set(transforms.leftHand)
        this.leftHand?.setTransformLocal(tempTransform);
    }
}

export class PeerNetworkedPlayerSpawner extends Component {
    static TypeName = 'peer-networked-player-spawner';
    static Properties = {

    };
    static Dependencies = [PeerNetworkedPlayer];

    @property.mesh()
    headMesh: Mesh|null = null;

    @property.material()
    headMaterial: Material|null = null;
    
    @property.mesh()
    leftHandMesh: Mesh|null = null;
    
    @property.material()
    leftHandMaterial: Material|null = null;
    
    @property.mesh()
    rightHandMesh: Mesh|null = null;
    
    @property.material()
    rightHandMaterial: Material|null = null;
    
    count: number = 0;

    getEntity(username?: string) {
        const player = this.engine.scene.addObject(null);
        const children = this.engine.scene.addObjects(3, player, 3);

        children[0].name = 'Head';
        children[0].addComponent(MeshComponent, {
            mesh: this.headMesh,
            material: this.headMaterial,
        });

        children[1].name = 'LeftHand';
        children[1].addComponent(MeshComponent, {
            mesh: this.leftHandMesh,
            material: this.leftHandMaterial,
        });

        children[2].name = 'RightHand';
        children[2].addComponent(MeshComponent, {
            mesh: this.rightHandMesh,
            material: this.rightHandMaterial,
        });

        player.name = username ?? `Player ${this.count++}`;
        return player.addComponent(PeerNetworkedPlayer);
    }

    returnEntity(player: PeerNetworkedPlayer) {
        player.object.children.forEach((c: Object3D) => {
            c.active = false;
        });
        player.object.active = false;
    }
}
