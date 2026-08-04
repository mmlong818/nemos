export interface GroupRouteMember {
  id: string;
  name: string;
}

export interface GroupReplyRoute {
  responderPersonaIds?: string[];
  explicitlyMentionedPersonaIds?: string[];
  coordinatorPersonaId?: string;
}

export interface GroupParticipation {
  directlyMentioned: boolean;
  coordinating: boolean;
}

export function selectGroupResponderIds(memberIds: string[], route?: GroupReplyRoute): string[] {
  const validIds = new Set(memberIds);
  const explicitlyMentioned = (route?.explicitlyMentionedPersonaIds ?? []).filter((id) => validIds.has(id));
  const routedResponders = (route?.responderPersonaIds ?? []).filter((id) => validIds.has(id));
  if (routedResponders.length > 0) return routedResponders;
  if (explicitlyMentioned.length > 0) return explicitlyMentioned;
  return memberIds;
}

export function groupParticipationFor(personaId: string, route?: GroupReplyRoute): GroupParticipation {
  const directlyMentioned = (route?.explicitlyMentionedPersonaIds ?? []).includes(personaId);
  return {
    directlyMentioned,
    coordinating: route?.coordinatorPersonaId === personaId && !directlyMentioned,
  };
}

export function resolveGroupReplyRoute(
  groupId: string,
  text: string,
  members: GroupRouteMember[],
  advisoryGroupId: string,
  coordinatorPersonaId = "zhiwei",
): GroupReplyRoute {
  const body = text || "";
  const explicitlyMentionedPersonaIds = members
    .filter((member) => {
      const names = [member.name, member.id].filter(Boolean);
      return names.some((name) => body.includes(`@${name}`) || body.includes(`＠${name}`));
    })
    .map((member) => member.id);

  if (explicitlyMentionedPersonaIds.length > 0) {
    return {
      responderPersonaIds: explicitlyMentionedPersonaIds,
      explicitlyMentionedPersonaIds,
    };
  }

  if (groupId === advisoryGroupId && members.some((member) => member.id === coordinatorPersonaId)) {
    return {
      responderPersonaIds: [coordinatorPersonaId],
      explicitlyMentionedPersonaIds: [],
      coordinatorPersonaId,
    };
  }

  return { explicitlyMentionedPersonaIds: [] };
}