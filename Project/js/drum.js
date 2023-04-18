import {Component, Type} from '@wonderlandengine/api';
import * as Tone from 'tone';

export class Drum extends Component {
    static TypeName = 'drum';
    static Properties = {
        networkObject: {type: Type.Object},
    };

    start() {
        this.networkComponent = this.networkObject.getComponent('peer-manager');
        this.networkComponent.addNetworkDataRecievedCallback(
            'drumPlay',
            this.playSound.bind(this)
        );
        this.sound = this.object.getComponent('howler-audio-source');
        this.collision = this.object.getComponent('collision');
        this.lastOverlaps = [];
        this.tempVec = new Float32Array(3);
        this.synth = new Tone.MembraneSynth().toDestination();
        this.notes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        this.amountOctaves = 2;
        this.baseNum = 1 / (this.notes.length * this.amountOctaves);
    }

    playSound(position) {
        if (position instanceof ArrayBuffer) position = new Float32Array(position);
        let noteNum = Math.floor(position[1] / this.baseNum);
        noteNum = Math.min(noteNum, this.notes.length * this.amountOctaves);
        let octave = noteNum / this.notes.length;
        let note = noteNum % this.notes.length;

        let finalNote = this.notes[note] + '' + octave;
        this.synth.triggerAttackRelease(finalNote, '2n');
    }

    update(_) {
        this.overlaps = this.collision.queryOverlaps();
        this.overlapNames = [];
        if (this.overlaps.length) {
            for (let i = 0; i < this.overlaps.length; i++) {
                let objName = this.overlaps[i].object.name;
                if (!this.lastOverlaps.includes(objName)) {
                    this.overlaps[i].object.getTranslationWorld(this.tempVec);
                    this.onEnter(this.tempVec);
                }
                this.overlapNames.push(objName);
            }
        }
        this.lastOverlaps = this.overlapNames;
    }

    onEnter(position) {
        this.playSound(position);
        this.networkComponent.sendPackage('drumPlay', position);
    }

    onLeave() {}
}
