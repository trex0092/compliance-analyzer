/**
 * Tracks the mapping between local entity IDs (cases, alerts, approvals, reviews)
 * and their corresponding Asana task GIDs.
 *
 * This enables two-way sync: when a task is completed in Asana,
 * we can find the local entity and mark it accordingly.
 */

const LINKS_KEY = 'asana_task_links';

export type LinkType = 'case' | 'alert' | 'approval' | 'review';

export interface AsanaTaskLink {
  localId: string;
  localType: LinkType;
  asanaGid: string;
  projectGid: string;
  customerId?: string;
  createdAt: string;
  completedAt?: string;
  completedInAsana: boolean;
}

function readLinks(): AsanaTaskLink[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    return raw ? (JSON.parse(raw) as AsanaTaskLink[]) : [];
  } catch {
    return [];
  }
}

function writeLinks(links: AsanaTaskLink[]): void {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  } catch {
    console.error('Failed to persist Asana task links');
  }
}

export function addTaskLink(
  localId: string,
  localType: LinkType,
  asanaGid: string,
  projectGid: string,
  customerId?: string
): void {
  const links = readLinks();
  // Avoid duplicate links for same local entity
  const existing = links.find((l) => l.localId === localId && l.localType === localType);
  if (existing) {
    existing.asanaGid = asanaGid;
    existing.projectGid = projectGid;
    writeLinks(links);
    return;
  }

  links.push({
    localId,
    localType,
    asanaGid,
    projectGid,
    customerId,
    createdAt: new Date().toISOString(),
    completedInAsana: false,
  });
  writeLinks(links);
}

export function findLinkByAsanaGid(asanaGid: string): AsanaTaskLink | undefined {
  return readLinks().find((l) => l.asanaGid === asanaGid);
}

export function findLinkByLocalId(localId: string, localType: LinkType): AsanaTaskLink | undefined {
  return readLinks().find((l) => l.localId === localId && l.localType === localType);
}

export function markLinkCompleted(asanaGid: string): void {
  const links = readLinks();
  const link = links.find((l) => l.asanaGid === asanaGid);
  if (link) {
    link.completedInAsana = true;
    link.completedAt = new Date().toISOString();
    writeLinks(links);
  }
}

export function getAllLinks(filter?: {
  type?: LinkType;
  completedOnly?: boolean;
}): AsanaTaskLink[] {
  let links = readLinks();
  if (filter?.type) {
    links = links.filter((l) => l.localType === filter.type);
  }
  if (filter?.completedOnly) {
    links = links.filter((l) => l.completedInAsana);
  }
  return links;
}

export function getLinkStats(): {
  total: number;
  completed: number;
  active: number;
  byType: Record<LinkType, { total: number; completed: number }>;
} {
  const links = readLinks();
  const byType: Record<LinkType, { total: number; completed: number }> = {
    case: { total: 0, completed: 0 },
    alert: { total: 0, completed: 0 },
    approval: { total: 0, completed: 0 },
    review: { total: 0, completed: 0 },
  };

  for (const l of links) {
    if (byType[l.localType]) {
      byType[l.localType].total++;
      if (l.completedInAsana) byType[l.localType].completed++;
    }
  }

  const total = links.length;
  const completed = links.filter((l) => l.completedInAsana).length;
  return { total, completed, active: total - completed, byType };
}
