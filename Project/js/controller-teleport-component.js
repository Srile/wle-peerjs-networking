WL.registerComponent("controller-teleport-component", {
    /** Object that will be placed as indiciation for where the player will teleport to. */
    teleportIndicatorMeshObject: {type: WL.Type.Object, default: null},
    /** Root of the player, the object that will be positioned on teleportation. */
    camRoot: {type: WL.Type.Object, default: null},
    cam: {type: WL.Type.Object, default: null},
    /** Collision group of valid "floor" objects that can be teleported on */
    floorGroup: {type: WL.Type.Int, default: 1},
    thumbstickActivationThreshhold: {type: WL.Type.Float, default: -0.7},
    thumbstickDeactivationThreshhold: {type: WL.Type.Float, default: 0.3},
    indicatorYOffset: {type: WL.Type.Float, default: 0.0},
    snapTurnAmount: {type: WL.Type.Float, default: 0.6},
}, {
    init: function() {
        this.thumbstickActivationThreshhold = -0.7
        this.prevThumbstickYAxisInput = 0;
        this.prevThumbstickXAxisInput = 0;
        this.input = this.object.getComponent('input');
        this._tempVec = [0,0,0];
        this._camRotation = 0;
        this._currentIndicatorRotation = 0;
        if(!this.input) {
            console.error(this.object.name, "controller-teleport-component.js: input component is required on the object.")
            return;
        }
        if(this.teleportIndicatorMeshObject) {
            this.isIndicating = false;

            this.indicatorHidden = true;
            this.hitSpot = undefined;
        } else {
            console.error(this.object.name, 'controller-teleport-component.js: Teleport indicator mesh is missing.');
        }
    },
    start: function() {
        WL.onXRSessionStart.push(this.setupVREvents.bind(this));
    },
    update: function() {
        let thumbstickXAxisInput = 0;
        let thumbstickYAxisInput = 0;
        let inputLength = 0;
        if(this.gamepadLeft && this.gamepadLeft.axes) {
          thumbstickXAxisInput = this.gamepadLeft.axes[2];
          thumbstickYAxisInput = this.gamepadLeft.axes[3];
          inputLength = Math.abs(thumbstickXAxisInput) + Math.abs(thumbstickYAxisInput);
        }

        if(!this.isIndicating && this.prevThumbstickYAxisInput >= this.thumbstickActivationThreshhold && thumbstickYAxisInput < this.thumbstickActivationThreshhold) {
          this.isIndicating = true;
          this.cam.getForward(this._tempVec);
          this._tempVec[1] = 0;
          glMatrix.vec3.normalize(this._tempVec, this._tempVec);
          this._camRotation = Math.atan2(this._tempVec[0], this._tempVec[2]);
        } else if(this.isIndicating && inputLength < this.thumbstickDeactivationThreshhold) {
          this.isIndicating = false;
          this.teleportIndicatorMeshObject.translate([1000, 1000, 1000]);

          if(this.hitSpot && this.camRoot) {
              this.camRoot.resetTransform();

              // this.session.requestReferenceSpace("local").then(function(xrReferenceSpace) {
              //    this.session.requestAnimationFrame(function(time, xrFrame) {
              //      console.log(xrFrame.getViewerPose(xrReferenceSpace).transform)
              //    })
              // }.bind(this))
              this.hitSpot[1] = 0;
              this.cam.getForward(this._tempVec);
              this._tempVec[1] = 0;
              glMatrix.vec3.normalize(this._tempVec, this._tempVec);
              this._camRotation = Math.atan2(this._tempVec[0], this._tempVec[2]);
              this._camRotation = this._currentIndicatorRotation - this._camRotation;
              this.camRoot.rotateAxisAngleRad([0, 1, 0], this._camRotation);
              this.camRoot.translate(this.hitSpot);
          } else if(!this.camRoot) {
              console.error(this.object.name, 'controller-teleport-component.js: Cam Root reference is missing.');
          }
        }

        if(this.isIndicating && this.teleportIndicatorMeshObject && this.input)
        {
            let origin = [0, 0, 0];
            glMatrix.quat2.getTranslation(origin, this.object.transformWorld);

            let quat = this.object.transformWorld;

            let forwardDirection = [0, 0, 0];
            glMatrix.vec3.transformQuat(forwardDirection, [0, 0, -1], quat);
            let rayHit = WL.scene.rayCast(origin, forwardDirection, 1 << this.floorGroup);
            if(rayHit.hitCount > 0) {
                if(this.indicatorHidden) {
                    this.indicatorHidden = false;
                }

                this._currentIndicatorRotation = this._camRotation + (Math.PI + Math.atan2(thumbstickXAxisInput, thumbstickYAxisInput));
                this.teleportIndicatorMeshObject.resetTranslationRotation();
                this.teleportIndicatorMeshObject.rotateAxisAngleRad([0, 1, 0], this._currentIndicatorRotation);

                this.teleportIndicatorMeshObject.translate(rayHit.locations[0]);


                this.hitSpot = rayHit.locations[0];
                if(this.indicatorYOffset) {
                  this.hitSpot[2] += this.indicatorYOffset;
                }
            } else {
                if(!this.indicatorHidden) {
                    this.teleportIndicatorMeshObject.translate([1000, 1000, 1000]);
                    this.indicatorHidden = true;
                }
                this.hitSpot = undefined;
            }
        } else {
          if(Math.abs(this.prevThumbstickXAxisInput) <= Math.abs(this.thumbstickActivationThreshhold) && Math.abs(thumbstickXAxisInput) > Math.abs(this.thumbstickActivationThreshhold)) {
            this.camRoot.getTranslationWorld(this._tempVec);
            this._camRotation -= Math.sign(thumbstickXAxisInput) * this.snapTurnAmount;
            this.camRoot.resetTranslationRotation();
            this.camRoot.rotateAxisAngleRad([0, 1, 0], this._camRotation);
            this.camRoot.translate(this._tempVec);
          }
        }

        this.prevThumbstickXAxisInput = thumbstickXAxisInput;
        this.prevThumbstickYAxisInput = thumbstickYAxisInput;
    },
    setupVREvents: function(s) {
        /* If in VR, one-time bind the listener */
        this.session = s;
        s.addEventListener('end', function(e) {
            /* Reset cache once the session ends to rebind select etc, in case
             * it starts again */
            this.gamepad = null;
            this.session = null;
        }.bind(this));

        if(s.inputSources && s.inputSources.length) {
          for (var i = 0; i < s.inputSources.length; i++) {
            let inputSource = s.inputSources[i];

            if(inputSource.handedness == "right") {
              this.gamepadRight = inputSource.gamepad;
            } else {
              this.gamepadLeft = inputSource.gamepad;
            }
          }
        }

        s.addEventListener('inputsourceschange' ,function(e) {
          if(e.added && e.added.length) {
            for (var i = 0; i < e.added.length; i++) {
              let inputSource = e.added[i];
              if(inputSource.handedness == "right") {
                this.gamepadRight = inputSource.gamepad;
              } else {
                this.gamepadLeft = inputSource.gamepad;
              }
            }
          }
        }.bind(this));


    },
});
