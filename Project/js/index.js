/**
 * /!\ This file is auto-generated.
 *
 * This is the entry point of your standalone application.
 *
 * There are multiple tags used by the editor to inject code automatically:
 *     - `wle:auto-imports:start` and `wle:auto-imports:end`: The list of import statements
 *     - `wle:auto-register:start` and `wle:auto-register:end`: The list of component to register
 *     - `wle:auto-constants:start` and `wle:auto-constants:end`: The project's constants,
 *        such as the project's name, whether it should use the physx runtime, etc...
 *     - `wle:auto-benchmark:start` and `wle:auto-benchmark:end`: Append the benchmarking code
 */

/* wle:auto-imports:start */
import {Cursor} from '@wonderlandengine/components';
import {CursorTarget} from '@wonderlandengine/components';
import {HowlerAudioListener} from '@wonderlandengine/components';
import {MouseLookComponent} from '@wonderlandengine/components';
import {WasdControlsComponent} from '@wonderlandengine/components';
import {PeerManager} from 'wle-peerjs-networking';
import {PeerNetworkedPlayer} from 'wle-peerjs-networking';
import {PeerNetworkedPlayerPool} from 'wle-peerjs-networking';
import {ControllerTeleportComponent} from './controller-teleport-component.js';
import {Drum} from './drum.js';
import {NetworkButtons} from './network-buttons.js';
/* wle:auto-imports:end */

import {loadRuntime} from '@wonderlandengine/api';
import * as API from '@wonderlandengine/api'; // Deprecated: Backward compatibility.

/* wle:auto-constants:start */
const Constants = {
    ProjectName: 'PeerTest',
    RuntimeBaseName: 'WonderlandRuntime',
    WebXRRequiredFeatures: ['local-floor',],
    WebXROptionalFeatures: ['local-floor','hand-tracking','hit-test',],
};
const RuntimeOptions = {
    physx: false,
    loader: false,
    xrFramebufferScaleFactor: 1,
    xrOfferSession: {
        mode: 'auto',
        features: Constants.WebXRRequiredFeatures,
        optionalFeatures: Constants.WebXROptionalFeatures,
    },
    canvas: 'canvas',
};
/* wle:auto-constants:end */

async function main() {
    const engine = await loadRuntime(Constants.RuntimeBaseName, RuntimeOptions);
    engine.erasePrototypeOnDestroy = true;

    Object.assign(engine, API); // Deprecated: Backward compatibility.

    engine.onSceneLoaded.once(() => {
        const el = document.getElementById('version');
        if (el) setTimeout(() => el.remove(), 2000);
    });

    /* WebXR setup. */

    function requestSession(mode) {
        engine
            .requestXRSession(mode, Constants.WebXRRequiredFeatures, Constants.WebXROptionalFeatures)
            .catch((e) => console.error(e));
    }

    function setupButtonsXR() {
        /* Setup AR / VR buttons */
        const arButton = document.getElementById('ar-button');
        if (arButton) {
            arButton.dataset.supported = engine.arSupported;
            arButton.addEventListener('click', () => requestSession('immersive-ar'));
        }
        const vrButton = document.getElementById('vr-button');
        if (vrButton) {
            vrButton.dataset.supported = engine.vrSupported;
            vrButton.addEventListener('click', () => requestSession('immersive-vr'));
        }
    }

    function setXRButtonVisibility(active) {
        const xrButtonContainer = document.querySelector('.xr-button-container');
        if(xrButtonContainer) {
            xrButtonContainer.style.display = active ? 'block' : 'none';
        }

        const startBtn = document.getElementById('start-btn');
        if(startBtn) {
            startBtn.style.display = active ? 'unset' : 'none';
        }
    }

    engine.onXRSessionStart.add(() => {
        setXRButtonVisibility(false);
    })

    engine.onXRSessionEnd.add(() => {
        setXRButtonVisibility(true);
    })

    if (document.readyState === 'loading') {
        window.addEventListener('load', setupButtonsXR);
    } else {
        setupButtonsXR();
    }

    /* wle:auto-register:start */
engine.registerComponent(Cursor);
engine.registerComponent(CursorTarget);
engine.registerComponent(HowlerAudioListener);
engine.registerComponent(MouseLookComponent);
engine.registerComponent(WasdControlsComponent);
engine.registerComponent(PeerManager);
engine.registerComponent(PeerNetworkedPlayer);
engine.registerComponent(PeerNetworkedPlayerPool);
engine.registerComponent(ControllerTeleportComponent);
engine.registerComponent(Drum);
engine.registerComponent(NetworkButtons);
/* wle:auto-register:end */

    engine.scene.load(`${Constants.ProjectName}.bin`);
}

main();

/* wle:auto-benchmark:start */
/* wle:auto-benchmark:end */
