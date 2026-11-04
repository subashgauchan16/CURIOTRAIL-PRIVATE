// Destination and quest states derived purely from saved progress + world data.
// The same functions drive the 3D markers, the accessible list and the HUD.

import type { CurriculumModule, Destination, Quest, World } from './types';
import type { Progress } from './progress-store';
import { questRecord } from './progress-store';

export type QuestStatus = 'locked' | 'available' | 'in-progress' | 'completed';
export type DestinationStatus = QuestStatus | 'planned';

export function isQuestCompleted(progress: Progress, questId: string): boolean {
  return questRecord(progress, questId).completed;
}

/** Unlocks follow mastery: a quest with a boss must reach its mastery threshold, not just be finished. */
export function isQuestMastered(progress: Progress, questId: string): boolean {
  const record = questRecord(progress, questId);
  return record.completed && record.mastered;
}

export function isDestinationUnlocked(destination: Destination, progress: Progress): boolean {
  if (destination.unlockedBy === 'planned') return false;
  return destination.unlockedBy.every((id) => isQuestMastered(progress, id));
}

export function questStatus(quest: Quest, destination: Destination, progress: Progress): QuestStatus {
  if (!isDestinationUnlocked(destination, progress)) return 'locked';
  // Within a destination, quests unlock in order; quests may also require others.
  const index = destination.quests.indexOf(quest.id);
  if (index > 0 && !isQuestMastered(progress, destination.quests[index - 1])) return 'locked';
  if ((quest.requires || []).some((id) => !isQuestMastered(progress, id))) return 'locked';
  const record = questRecord(progress, quest.id);
  // An unfinished run (a first attempt or a replay) takes precedence.
  if (record.run && !record.run.completed) return 'in-progress';
  if (record.completed) return 'completed';
  return 'available';
}

export function destinationStatus(destination: Destination, quests: Map<string, Quest>, progress: Progress): DestinationStatus {
  if (destination.unlockedBy === 'planned') return 'planned';
  if (!isDestinationUnlocked(destination, progress)) return 'locked';
  const statuses = destination.quests.map((id) => {
    const quest = quests.get(id);
    return quest ? questStatus(quest, destination, progress) : 'locked';
  });
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'in-progress')) return 'in-progress';
  return 'available';
}

/** The quest a destination's main button should open, or null. */
export function nextQuestAt(destination: Destination, quests: Map<string, Quest>, progress: Progress): Quest | null {
  for (const id of destination.quests) {
    const quest = quests.get(id);
    if (!quest) continue;
    const status = questStatus(quest, destination, progress);
    if (status === 'available' || status === 'in-progress') return quest;
  }
  return null;
}

/**
 * The quest to suggest next: the first playable (available or in-progress)
 * quest in the world's recommended order, then any other in map order.
 * A suggestion only; unlock rules are unchanged.
 */
export function recommendedNext(world: World, quests: Map<string, Quest>, progress: Progress, excludeId?: string): Quest | null {
  const playable = (id: string) => {
    const quest = quests.get(id);
    const dest = quest ? world.destinations.find((d) => d.quests.includes(id)) : undefined;
    if (!quest || !dest || id === excludeId) return null;
    const status = questStatus(quest, dest, progress);
    return status === 'available' || status === 'in-progress' ? quest : null;
  };
  for (const id of world.recommendedOrder ?? []) {
    const q = playable(id);
    if (q) return q;
  }
  for (const d of world.destinations) {
    for (const id of d.quests) {
      const q = playable(id);
      if (q) return q;
    }
  }
  return null;
}

export function unlockRequirement(destination: Destination, quests: Map<string, Quest>, progress: Progress): string {
  if (destination.unlockedBy === 'planned') return 'Planned for a future update. There is no playable quest here yet.';
  const missing = destination.unlockedBy.filter((id) => !isQuestMastered(progress, id));
  if (!missing.length) return '';
  const names = missing.map((id) => quests.get(id)?.title ?? id);
  const verb = missing.some((id) => isQuestCompleted(progress, id)) ? 'Pass the final challenge of' : 'Complete';
  return `${verb} ${names.map((n) => `“${n}”`).join(' and ')} to unlock.`;
}

export function destinationForQuest(world: World, questId: string): Destination | undefined {
  return world.destinations.find((d) => d.quests.includes(questId));
}

/** Destinations that become available because this quest was just completed. */
export function newlyUnlocked(world: World, before: Progress, after: Progress): Destination[] {
  return world.destinations.filter((d) => !isDestinationUnlocked(d, before) && isDestinationUnlocked(d, after));
}

/** Why a quest is locked, in words, or '' when it isn't. */
export function questRequirement(quest: Quest, destination: Destination, quests: Map<string, Quest>, progress: Progress): string {
  const destinationText = unlockRequirement(destination, quests, progress);
  if (destinationText) return destinationText;
  const index = destination.quests.indexOf(quest.id);
  const missing = [
    ...(index > 0 && !isQuestMastered(progress, destination.quests[index - 1]) ? [destination.quests[index - 1]] : []),
    ...(quest.requires || []).filter((id) => !isQuestMastered(progress, id)),
  ];
  const unique = [...new Set(missing)];
  if (!unique.length) return '';
  return `Complete ${unique.map((id) => `\u201c${quests.get(id)?.title ?? id}\u201d`).join(' and ')} first.`;
}

// ---- Curriculum modules ----

export type ModuleStatus = 'planned' | 'locked' | 'available' | 'in-progress' | 'completed';

/**
 * A module's status comes only from its real content: planned when it has no
 * playable quests yet, otherwise from the status of its quests.
 */
export function moduleStatus(module: CurriculumModule, world: World, quests: Map<string, Quest>, progress: Progress): ModuleStatus {
  const playable = module.quests.filter((id) => quests.has(id));
  if (!playable.length) return 'planned';
  const statuses = playable.map((id) => {
    const quest = quests.get(id)!;
    const dest = destinationForQuest(world, id);
    return dest ? questStatus(quest, dest, progress) : 'locked';
  });
  if (statuses.every((st) => st === 'completed')) return 'completed';
  if (statuses.some((st) => st === 'in-progress' || st === 'completed')) return 'in-progress';
  if (statuses.some((st) => st === 'available')) return 'available';
  return 'locked';
}

export function moduleForQuest(modules: CurriculumModule[], questId: string): CurriculumModule | undefined {
  return modules.find((m) => m.quests.includes(questId));
}
