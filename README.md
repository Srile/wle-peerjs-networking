## Wonderland Engine Basic Networking Components

A small set of components for [Wonderland Engine](https://wonderlandengine.com/ "Wonderland Engine") for basic networking functionalities using [peer.js](https://peerjs.com/ "peer.js").

This project uses host-client architecture, where the host can simply host by calling `host()` and a client can join by calling `join()`. It supports voice chat out of the box and also handles disconnects and kicking. It can be used as a started for a variety of multi user WebXR projects with Wonderland Engine.

This repository includes a basic scene that you can use as a template for your projects. Anything within the project not documented here is included as part of the polishing of the scene and has been imported from other repositories with permission. Setup instructions can also be found below.

### Setup

You can reference the included `example-scene.wlp` scene for the setup.

> Please copy the `audio` folder into `deploy`, if you are working with `example-scene.wlp`

Using the default Wonderland Engine setup, after adding the hand objects, you should have the following scene structure for the user:

	Player
	├── NonVrCamera
	├── EyeLeft
	├── EyeRight
	├── RightHand
	└── LeftHand

This structure is useful for transmitting the positions and rotations of the camera and hands. These are used in the networking component.

Next, we need to create an object that contains all the networked objects and components.

> This project uses a technique called [object pooling](https://en.wikipedia.org/wiki/Object_pool_pattern "object pooling") for the connected players. This means that every object(s) for each joining player is already instantiated in the scene on startup.

Create an object on "root" and call it something like `PeerNetworkedPlayerPool`. This object will contain two components from this repository: `peer-networked-player-pool` and `peer-manager`. For the `peer-manager`, make sure your `serverId` is changed to a long and unique string. The placeholder text will work, but might cause issues if another instance of peer.js is using that id. The parameter `networkSendFrequencyInS` determines how often a client/the host sends packages over, this can be kept at the default. If you wish to have a higher frequency (means higher refresh rate), you could also lower it. A value of 0 would send packages every frame, for example. Set the player's head (eye for VR camera) and hands and also `networkPlayerPool` (this can be the same object).

After this has been done, You need to create the pool objects for each player. These need to be a child of the previously created object or the pooling will not work. Let's create a child object of `PeerNetworkedPlayerPool` called `PeerNetworkedPlayer` and a `peer-networked-player` component onto it. Additionally the following hierarchy (naming important here) needs to be recreated under the object:

	PeerNetworkedPlayer
	├── Head
	├── RightHand
	└── LeftHand

You can add meshes to each object for visualisastion, if you like. We can now copy the hierarchy of `PeerNetworkedPlayer` and the scene is done. Just call either the `host()` or `join()` functions to see your scene in action.

> You might want to expose a reference in `peer-manager`'s init such as `window.peerManager = this` for testing via console

### Public members

#### peer-manager component

| Functions | Description |
| ------------ | ------------ |
| host() | Hosts a server with `serverId` as id |
| join() | Joins a server with `serverId` as Id |
| connect(id) | Joins a server with the supplied id |
| disconnect() | Disconnects from the server (client) / Ends the server (host) |
| kick(id) | (Host) Kicks the user with the id |
| sendPackage(key, data) | Sends a package to all users (host & clients), that calls the correspondingly registered callback in `addNetworkDataRecievedCallback` |
| toggleMute() | Toggles the user's audio input's mute setting. |
| setOwnMute(mute) | Sets the user's audio input's mute setting |
| setOtherMute(id, mute) | Sets another user's audio output's mute setting. |
| addConnectionEstablishedCallback(f) / removeConnectionEstablishedCallback(f) | Adds/removes a function to/from a callback list, that gets called when a connection is established. (host & client) |
| addDisconnectCallback(f) / removeDisconnectCallback(f) | Adds/removes a function to/from a callback list, that happens when a disconnection occurs. |
| addNetworkDataRecievedCallback(key, f) / removeNetworkDataRecievedCallback(key) | Adds a function callback, that gets called if a package with the registered key is recieved. See `sendPackage(key, data)`.|

| Variables | Description |
| ------------ | ------------ |
| activePlayers | Object containing currently connected active players. |
| peer | Contains the peer.js object with the connection, id, etc.|

### Possible future improvements:

- Expanding pool: allow more users to join then the defined amount in the scene via dynamically expanding (and perhaps shrinking) the pool.

### Credits

peer.js - Copyright (c) 2015 Michelle Bu and Eric Zhang, http://peerjs.com
Tone.js - Copyright (c) 2014-2020 Yotam Mann https://github.com/Tonejs/Tone.js
