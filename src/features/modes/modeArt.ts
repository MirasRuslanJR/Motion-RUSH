import bossArt from '../../assets/modes/boss.svg';
import danceDuoArt from '../../assets/modes/dance-duo.svg';
import danceArt from '../../assets/modes/dance.svg';
import duoArt from '../../assets/modes/duo.svg';
import freezeArt from '../../assets/modes/freeze.svg';
import onlineArt from '../../assets/modes/online.svg';
import reactionArt from '../../assets/modes/reaction.svg';
import runArt from '../../assets/modes/run.svg';
import squatsArt from '../../assets/modes/squats.svg';
import starsArt from '../../assets/modes/stars.svg';
import type { GameModeId } from './modes';

/** Cover art of the mode cards (SVGs in src/assets/modes). Every runner mode shares the track scene. */
const ART: Partial<Record<GameModeId, string>> = {
  dance: danceArt,
  'dance-duo': danceDuoArt,
  versus: duoArt,
  duel: onlineArt,
  stars: starsArt,
  freeze: freezeArt,
  reaction: reactionArt,
  squats: squatsArt,
  boss: bossArt,
};

export function modeArt(id: GameModeId): string {
  return ART[id] ?? runArt;
}
