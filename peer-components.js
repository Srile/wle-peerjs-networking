import {Component, Type} from '@wonderlandengine/api';

export let isHost = false;
var Peer;

export class PeerManager extends Component {
    static TypeName = 'peer-manager';
    static Properties = {
        serverId: {
            type: Type.String,
            default: 'THISISAWONDERLANDENGINEPLACEHOLDER',
        },
        networkSendFrequencyInS: {type: Type.Float, default: 0.01},
        playerHead: {type: Type.Object},
        playerRightHand: {type: Type.Object},
        playerLeftHand: {type: Type.Object},
        networkPlayerPool: {type: Type.Object},
        voiceEnabled: {type: Type.Bool, default: true},
    };

    init() {
        /* We need to require() peerjs, since it uses 'navigator' in the
         * global scope, which isn't available when Wonderland Editor evaluates
         * the bundle for finding components */
        Peer = require('peerjs').Peer;

        this.streams = {};

        this.activePlayers = {};
        this.currentDataPackage = {};
        this.calls = {};
        this.connections = [];
        this.currentTime = 0.0;

        // Dual quaternions for sending head, left and right hand transforms
        this.headDualQuat = new Float32Array(8);
        this.rightHandDualQuat = new Float32Array(8);
        this.leftHandDualQuat = new Float32Array(8);

        // Records user audio
        this.audio = document.createElement('AUDIO');
        this.audio.id = 'localAudio';
        document.body.appendChild(this.audio);

        navigator.mediaDevices
            .getUserMedia({audio: true, video: false})
            .then((stream) => {
                this.localStream = stream;
            })
            .catch((err) => console.error('User denied audio access.', err));

        this.connectionEstablishedCallbacks = this.connectionEstablishedCallbacks || [];
        this.clientJoinedCallbacks = this.clientJoinedCallbacks || [];
        this.disconnectCallbacks = this.disconnectCallbacks || [];
        this.registeredNetworkCallbacks = this.registeredNetworkCallbacks || {};
    }

    start() {
        /* Try to get one of the two types of spawner component */
        this.networkPlayerSpawner =
            this.networkPlayerPool.getComponent(PeerNetworkedPlayerPool) ||
            this.networkPlayerPool.getComponent(PeerNetworkedPlayerSpawner);
    }

    //
    // Host functions
    //
    host() {
        this.peer = new Peer(this.serverId);
        this.peer.on('open', this._onHostOpen.bind(this));
        this.peer.on('connection', this._onHostConnected.bind(this));
        this.peer.on('disconnected', this._onDisconnected.bind(this));

        this.peer.on('call', (call) => {
            this.calls[call.peer] = call;
            call.answer(this.localStream);
            call.on('stream', (stream) => {
                const audio = document.createElement('AUDIO');
                audio.id = 'remoteAudio' + call.peer;
                document.body.appendChild(audio);
                audio.srcObject = stream;
                audio.autoplay = true;
                this.streams[call.peer] = stream;
            });
        });
    }

    kick(id) {
        this.currentDataPackage['disconnect'] = this.currentDataPackage['disconnect'] || [];
        this.currentDataPackage['disconnect'].push(id);
        this._removePlayer(id);
    }

    _onHostOpen(id) {
        isHost = true;
        this.serverId = id;
        this.activePlayers[this.serverId] = {};
        for (const cb of this.connectionEstablishedCallbacks) cb();
    }

    _onHostConnected(connection) {
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

    _onHostDataReceived(data, connection) {
        if (data.transforms && this.activePlayers[connection.peer]) {
            this.activePlayers[connection.peer].setTransforms(data.transforms);
        }

        for (const key of Object.keys(data)) {
            if (key == 'transforms') continue;
            if (this.registeredNetworkCallbacks[key]) {
                this.registeredNetworkCallbacks[key](data[key]);
            }
        }
        this.currentDataPackage[connection.peer] = data;
    }

    _onHostConnectionClose(connection) {
        this._removePlayer(connection.peer);
        this.object.setTranslationWorld([0, -1, 0]);
        this.disconnect();

        this.currentDataPackage['disconnect'] = this.currentDataPackage['disconnect'] || [];
        this.currentDataPackage['disconnect'].push(connection.peer);
    }

    _hostPlayerJoined(id) {
        let newPlayer = this.networkPlayerSpawner.getEntity();
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

    connect(id) {
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
                const audio = document.createElement('AUDIO');
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

    _onClientDataReceived(data) {
        const registeredCallbacksKeys = Object.keys(this.registeredNetworkCallbacks);
        const joined = 'joined' in data;

        for (const key of Object.keys(data)) {
            const value = data[key];
            if (key == 'joinedPlayers') {
                for (let j = 0; j < data.joinedPlayers.length; j++) {
                    const p = data.joinedPlayers[j];
                    // if the join id is the same, ignore
                    if (p == this.peer.id || this.activePlayers[p]) continue;
                    if (!joined && p != this.serverId) {
                        setTimeout(() => {
                            this.call(p);
                        }, Math.floor(500 * j));
                    }

                    const newPlayer = this.networkPlayerSpawner.getEntity();
                    this.activePlayers[p] = newPlayer;
                    for (const cb of this.clientJoinedCallbacks) cb(p, newPlayer);
                }
                continue;
            }

            if (key == 'call') continue;
            if (key == 'disconnect') {
                for (const v of value) this._removePlayer(v);
            }

            if (this.activePlayers[key]) {
                const values = Object.keys(value);
                for (const v of values) {
                    if (v == 'transforms') {
                        this.activePlayers[key].setTransforms(value.transforms);
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

    _removePlayer(peerId) {
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

        if (!this.activePlayers[peerId]) return;

        if (Object.keys(this.activePlayers[peerId]).length !== 0) {
            this.activePlayers[peerId].reset();
            this.networkPlayerSpawner.returnEntity(this.activePlayers[peerId]);
        }
        delete this.activePlayers[peerId];
    }

    // All functions
    _onDisconnected(connection) {
        this._removeAllPlayers();
        this.disconnect();
        for (let cb of this.disconnectCallbacks) cb(connection.peer);
    }

    call(id) {
        if (!this.voiceEnabled) return;

        if (!this.localStream) {
            /* If the page doesn't have permission to access
             * audio stream, creation of the call would fail */
            console.error('Cannot call: no audio stream');
            return;
        }
        const call = this.peer.call(id, this.localStream);
        this.calls[id] = call;
        call.on('stream', (stream) => {
            const audio = document.createElement('AUDIO');
            audio.id = id;
            document.body.appendChild(audio);
            audio.srcObject = stream;
            audio.autoplay = true;
            this.streams[id] = stream;
        });
    }

    _clientOnOpen() {
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

    addConnectionEstablishedCallback(f) {
        this.connectionEstablishedCallbacks = this.connectionEstablishedCallbacks || [];
        this.connectionEstablishedCallbacks.push(f);
    }

    removeConnectionEstablishedCallback(f) {
        const index = this.connectionEstablishedCallbacks.indexOf(f);
        if (index <= -1) return;

        this.connectionEstablishedCallbacks.splice(index, 1);
    }

    addClientJoinedCallback(f) {
        this.clientJoinedCallbacks = this.clientJoinedCallbacks || [];
        this.clientJoinedCallbacks.push(f);
    }

    removeClientJoinedCallback(f) {
        const index = this.clientJoinedCallbacks.indexOf(f);
        if (index <= -1) return;

        this.clientJoinedCallbacks.splice(index, 1);
    }

    addDisconnectCallback(f) {
        this.disconnectCallbacks = this.disconnectCallbacks || [];
        this.disconnectCallbacks.push(f);
    }

    removeDisconnectCallback(f) {
        const index = this.disconnectCallbacks.indexOf(f);
        if (index <= -1) return;

        this.disconnectCallbacks.splice(index, 1);
    }

    /* @deprecated Function was renamed to correct spelling */
    addNetworkDataRecievedCallback(...args) {
        return this.addNetworkDataReceivedCallback(...args);
    }

    addNetworkDataReceivedCallback(key, f) {
        this.registeredNetworkCallbacks = this.registeredNetworkCallbacks || {};
        this.registeredNetworkCallbacks[key] = f;
    }

    /* @deprecated Function was renamed to correct spelling */
    removeNetworkDataRecievedCallback(...args) {
        return this.removeNetworkDataReceivedCallback(...args);
    }

    removeNetworkDataReceivedCallback(key) {
        delete this.registeredNetworkCallbacks[key];
    }

    sendPackage(key, data) {
        this.currentDataPackage[key] = data;
    }

    sendPackageImmediately(key, data) {
        let p = {};
        p[key] = data;

        if (this.connection) {
            this.connection.send(p);
            return;
        }

        for (let con of this.connections) con.send(p);
    }

    toggleMute() {
        this.localStream.getTracks()[0].enabled = !this.localStream.getTracks()[0].enabled;
    }

    setOwnMute(mute) {
        this.localStream.getTracks()[0].enabled = !mute;
    }

    setOtherMute(id, mute) {
        if (this.streams[id]) this.streams[id].getTracks()[0].enabled = !mute;
    }

    update(dt) {
        if (!this.connection && this.connections.length == 0) return;

        this.currentTime += dt;
        if (this.currentTime < this.networkSendFrequencyInS) return;

        this.currentTime = 0.0;

        this.headDualQuat.set(this.playerHead.transformWorld);
        this.rightHandDualQuat.set(this.playerRightHand.transformWorld);
        this.leftHandDualQuat.set(this.playerLeftHand.transformWorld);

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
        } else {
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

    init() {
        this.inactivePool = [];
        for (let c of this.object.children) {
            this.inactivePool.push(c.getComponent(PeerNetworkedPlayer));
        }
    }

    getEntity() {
        if (this.inactivePool.length) return this.inactivePool.shift();
        console.error('peer-networked-player-pool: No more inactive entities');
    }

    returnEntity(entity) {
        this.inactivePool.push(entity);
    }
}

export class PeerNetworkedPlayer extends Component {
    static TypeName = 'peer-networked-player';
    static Properties = {
        nameTextObject: {type: Type.Object},
    };

    init() {
        for (let c of this.object.children) {
            if (c.name == 'Head') this.head = c;
            if (c.name == 'LeftHand') this.leftHand = c;
            if (c.name == 'RightHand') this.rightHand = c;
        }
    }

    setName(name) {
        if (this.nameTextObject) this.nameTextObject.getComponent('text').text = name;
    }

    reset() {
        this.head.resetTranslationRotation();
        this.rightHand.resetTranslationRotation();
        this.leftHand.resetTranslationRotation();
    }

    setTransforms(transforms) {
        this.head.transformLocal.set(new Float32Array(transforms.head));
        this.head.setDirty();

        this.rightHand.transformLocal.set(new Float32Array(transforms.rightHand));
        this.rightHand.setDirty();

        this.leftHand.transformLocal.set(new Float32Array(transforms.leftHand));
        this.leftHand.setDirty();
    }
}

export class PeerNetworkedPlayerSpawner extends Component {
    static TypeName = 'peer-networked-player-spawner';
    static Properties = {
        headMesh: {type: Type.Mesh},
        headMaterial: {type: Type.Material},
        leftHandMesh: {type: Type.Mesh},
        leftHandMaterial: {type: Type.Material},
        rightHandMesh: {type: Type.Mesh},
        rightHandMaterial: {type: Type.Material},
    };
    static Dependencies = [PeerNetworkedPlayer];

    init() {
        this.count = 0;
    }

    getEntity() {
        const player = this.engine.scene.addObject(1);
        const children = this.engine.scene.addObjects(3, player);

        children[0].name = 'Head';
        children[0].addComponent('mesh', {
            mesh: this.headMesh,
            material: this.headMaterial,
        });

        children[1].name = 'LeftHand';
        children[1].addComponent('mesh', {
            mesh: this.leftHandMesh,
            material: this.leftHandMaterial,
        });

        children[2].name = 'RightHand';
        children[2].addComponent('mesh', {
            mesh: this.rightHandMesh,
            material: this.rightHandMaterial,
        });

        player.name = `Player ${this.count++}`;
        return player.addComponent(PeerNetworkedPlayer);
    }

    returnEntity(player) {
        console.log('returning:', player);
        player.children.forEach((c) => {
            c.active = false;
        });
        player.active = false;
    }
}
