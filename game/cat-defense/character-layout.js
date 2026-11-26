import {ACTOR_BOUNDS} from './actor-bounds.js';

// Logical world units refer to the visible character, excluding transparent atlas padding.
export const CAT_POSE = Object.freeze({x:270,y:510,height:195});
export const ENEMY_BODY = Object.freeze({
  regular:Object.freeze({height:180,radius:52}),
  boss:Object.freeze({height:270,radius:78})
});

/** One reference body/ground pivot per actor, shared by every animation frame. */
export function actorLayout(actor, visibleHeight) {
  const bounds=ACTOR_BOUNDS[actor?.id]??{x:0,y:0,w:1,h:1};
  const aspect=(actor?.frameHeight||1)/(actor?.frameWidth||1);
  const height=visibleHeight/bounds.h;
  return {
    width:height/aspect,height,
    anchor:{x:bounds.x+bounds.w/2,y:bounds.y+bounds.h},
    bounds
  };
}
