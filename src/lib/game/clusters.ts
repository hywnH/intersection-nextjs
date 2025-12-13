import type { PlayerSnapshot, Vec2 } from "@/types/game";

const DEFAULT_CLUSTER_RADIUS = 420;

type WorldSize = { width: number; height: number };

const wrapCoord = (value: number, size: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0)
    return value;
  return ((value % size) + size) % size;
};

const wrapDelta = (delta: number, size: number) => {
  if (!Number.isFinite(delta) || !Number.isFinite(size) || size <= 0)
    return delta;
  return ((((delta + size / 2) % size) + size) % size) - size / 2;
};

const circularMean = (values: number[], period: number) => {
  if (!values.length || !Number.isFinite(period) || period <= 0) return 0;
  let sinSum = 0;
  let cosSum = 0;
  for (const v of values) {
    const angle = (2 * Math.PI * wrapCoord(v, period)) / period;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }
  const meanAngle = Math.atan2(sinSum / values.length, cosSum / values.length);
  const normalized = meanAngle < 0 ? meanAngle + 2 * Math.PI : meanAngle;
  return (normalized / (2 * Math.PI)) * period;
};

export interface PlayerClusterSummary {
  id: string;
  memberIds: string[];
  memberCount: number;
  centroid: Vec2;
  members: PlayerSnapshot[];
}

export interface AnnotatedCluster extends PlayerClusterSummary {
  label: string;
  rank: number;
  isMulti: boolean;
}

const averagePosition = (
  members: PlayerSnapshot[],
  worldSize?: WorldSize
): Vec2 => {
  if (members.length === 0) {
    return { x: 0, y: 0 };
  }
  // 토러스 월드에서는 경계(0/width)를 넘는 클러스터가 생길 수 있으므로 원형 평균을 사용
  if (worldSize && worldSize.width > 0 && worldSize.height > 0) {
    return {
      x: circularMean(
        members.map((m) => m.cell.position.x),
        worldSize.width
      ),
      y: circularMean(
        members.map((m) => m.cell.position.y),
        worldSize.height
      ),
    };
  }
  const total = members.reduce(
    (acc, member) => {
      acc.x += member.cell.position.x;
      acc.y += member.cell.position.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: total.x / members.length,
    y: total.y / members.length,
  };
};

export const computePlayerClusters = (
  players: PlayerSnapshot[],
  radius = DEFAULT_CLUSTER_RADIUS,
  worldSize?: WorldSize
): PlayerClusterSummary[] => {
  if (!players.length) {
    return [];
  }
  const visited = new Set<string>();
  const clusters: PlayerClusterSummary[] = [];
  const radiusSq = radius * radius;

  for (const seed of players) {
    if (visited.has(seed.id)) continue;
    const queue: PlayerSnapshot[] = [seed];
    const members: PlayerSnapshot[] = [];
    visited.add(seed.id);

    while (queue.length) {
      const current = queue.pop()!;
      members.push(current);
      for (const candidate of players) {
        if (visited.has(candidate.id)) continue;
        const rawDx = current.cell.position.x - candidate.cell.position.x;
        const rawDy = current.cell.position.y - candidate.cell.position.y;
        const dx =
          worldSize && worldSize.width > 0
            ? wrapDelta(rawDx, worldSize.width)
            : rawDx;
        const dy =
          worldSize && worldSize.height > 0
            ? wrapDelta(rawDy, worldSize.height)
            : rawDy;
        if (dx * dx + dy * dy <= radiusSq) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    const id = members[0]?.id ?? `cluster-${clusters.length}`;
    clusters.push({
      id,
      memberIds: members.map((member) => member.id),
      memberCount: members.length,
      centroid: averagePosition(members, worldSize),
      members,
    });
  }

  return clusters;
};

export const analyzeClusters = (
  players: PlayerSnapshot[],
  radius = DEFAULT_CLUSTER_RADIUS,
  worldSize?: WorldSize
): {
  clusters: AnnotatedCluster[];
  assignments: Map<string, AnnotatedCluster>;
} => {
  const baseClusters = computePlayerClusters(players, radius, worldSize);
  const sorted = [...baseClusters].sort(
    (a, b) => b.memberCount - a.memberCount
  );
  const annotated: AnnotatedCluster[] = sorted.map((cluster, index) => {
    const isMulti = cluster.memberCount > 1;
    return {
      ...cluster,
      label: isMulti ? `클러스터 ${index + 1}` : "단독",
      rank: index + 1,
      isMulti,
    };
  });

  const assignments = new Map<string, AnnotatedCluster>();
  annotated.forEach((cluster) => {
    cluster.memberIds.forEach((memberId) => {
      assignments.set(memberId, cluster);
    });
  });

  return {
    clusters: annotated,
    assignments,
  };
};
