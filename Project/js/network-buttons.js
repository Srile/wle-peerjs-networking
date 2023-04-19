import { CollisionComponent, Component, Type, Object3D } from '@wonderlandengine/api';
import { Cursor, CursorTarget } from '@wonderlandengine/components';
import { PeerManager } from 'wle-peerjs-networking';

export class NetworkButtons extends Component {
    static TypeName = 'network-buttons';
    static Properties = {
        peerManagerObject: {type: Type.Object},
        cursor: {type: Type.Object},
        hostButton: {type: Type.Object},
        joinButton: {type: Type.Object},
    };

    /** @type {Object3D} */
    peerManagerObject;

    start() {
        this.pm = this.peerManagerObject.getComponent(PeerManager);

        /* If hostButton or joinButton are not specified, we search
         * for them by name */
        for (let c of this.object.children) {
            if (c.name == 'HostButton') this.hostButton = this.hostButton || c;
            if (c.name == 'JoinButton') this.joinButton = this.joinButton || c;
        }

        this.hostButtonCollider = this.hostButton.getComponent(CollisionComponent);
        this.hostButton
            .getComponent(CursorTarget)
            .addClickFunction(this.pm.host.bind(this.pm));

        this.joinButtonCollider = this.joinButton.getComponent(CollisionComponent);
        this.joinButton
            .getComponent(CursorTarget)
            .addClickFunction(this.pm.join.bind(this.pm));

        this.pm.addConnectionEstablishedCallback(this.hide.bind(this));
        this.pm.addDisconnectCallback(this.show.bind(this));
    }

    show() {
        if (this.cursor.getComponent(Cursor).setEnabled)
            this.cursor.getComponent(Cursor).setEnabled(true);
        this.hostButtonCollider.active = true;
        this.joinButtonCollider.active = true;
        this.object.setTranslationLocal([0, 0, -3]);
    }

    hide() {
        /* Old versions of the cursor component don't have the setEnabled function */
        if (this.cursor.getComponent(Cursor).setEnabled)
            this.cursor.getComponent(Cursor).setEnabled(false);
        this.hostButtonCollider.active = false;
        this.joinButtonCollider.active = false;
        this.object.setTranslationLocal([0, -300, 0]);
    }
}
