import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnalysisDTO,
  AnalysisSummaryDTO,
  AuditEventDTO,
  ConsumerDTO,
  FindingDTO,
  ImpactDTO,
  InvitationDTO,
  MemberDTO,
  NotificationDTO,
  OverviewDTO,
  PageMeta,
  PolicyDTO,
  ProjectDTO,
  ReviewDTO,
  Role,
  UpdatePolicyInput,
  UserDTO,
  VersionDTO,
  WorkspaceDTO,
} from '@jky/shared';
import type { AnalysisOptions, FindingSeverity, Protocol, RuleDefinition } from '@jky/radar-core';
import { api } from './api';

/** Analyses are read either from a private workspace or from the public demo. */
export type AnalysisScope = 'private' | 'demo';
export const analysisBase = (scope: AnalysisScope, id: string) =>
  scope === 'demo' ? `/demo/analyses/${id}` : `/analyses/${id}`;

/* ----------------------------------------------------------- meta */
export interface CapabilitiesDTO {
  engineVersion: string;
  ruleRegistryVersion: string;
  adapterVersion: string;
  adapters: Array<{
    id: string;
    protocol: Protocol | null;
    label: string;
    formats: string[];
    versions: string;
    status: 'supported' | 'partial' | 'experimental' | 'unsupported';
    levels: { parse: string; semanticDiff: string; classification: string };
    release: string;
    notes: string[];
    rules: { registered: number; tested: number };
  }>;
  limits: Record<string, number>;
  remoteUrlImport: boolean;
  roles: Record<Role, string>;
  limitations: string[];
}
export const useCapabilities = () =>
  useQuery({
    queryKey: ['capabilities'],
    queryFn: async () => (await api.get<CapabilitiesDTO>('/capabilities')).data,
    staleTime: 10 * 60_000,
  });
export const useRules = () =>
  useQuery({
    queryKey: ['rules'],
    queryFn: async () => (await api.get<RuleDefinition[]>('/rules')).data,
    staleTime: 10 * 60_000,
  });

/* ----------------------------------------------------------- workspaces */
export const useWorkspaces = (enabled = true) =>
  useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => (await api.get<WorkspaceDTO[]>('/workspaces')).data,
    enabled,
  });
export const useWorkspace = (wid?: string) =>
  useQuery({
    queryKey: ['workspace', wid],
    queryFn: async () => (await api.get<WorkspaceDTO>(`/workspaces/${wid}`)).data,
    enabled: !!wid,
  });
export const useOverview = (wid?: string) =>
  useQuery({
    queryKey: ['overview', wid],
    queryFn: async () => (await api.get<OverviewDTO>(`/workspaces/${wid}/overview`)).data,
    enabled: !!wid,
  });
export const useMembers = (wid?: string) =>
  useQuery({
    queryKey: ['members', wid],
    queryFn: async () => (await api.get<MemberDTO[]>(`/workspaces/${wid}/members`)).data,
    enabled: !!wid,
  });
export const useInvitations = () =>
  useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get<InvitationDTO[]>('/invitations')).data,
  });
export const useAudit = (wid: string | undefined, page: number) =>
  useQuery({
    queryKey: ['audit', wid, page],
    queryFn: async () =>
      api.get<AuditEventDTO[], PageMeta>(`/workspaces/${wid}/audit?page=${page}&pageSize=30`),
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });
export const useWorkspaceAnalyses = (wid: string | undefined, page: number) =>
  useQuery({
    queryKey: ['ws-analyses', wid, page],
    queryFn: async () =>
      api.get<AnalysisSummaryDTO[], PageMeta>(`/workspaces/${wid}/analyses?page=${page}&pageSize=20`),
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });

/* ----------------------------------------------------------- projects */
export const useProjects = (wid?: string, search?: string) =>
  useQuery({
    queryKey: ['projects', wid, search ?? ''],
    queryFn: async () =>
      (
        await api.get<ProjectDTO[]>(
          `/workspaces/${wid}/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`,
        )
      ).data,
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });
export const useProject = (pid?: string) =>
  useQuery({
    queryKey: ['project', pid],
    queryFn: async () => (await api.get<ProjectDTO & { role: Role }>(`/projects/${pid}`)).data,
    enabled: !!pid,
  });
export const useVersions = (pid?: string) =>
  useQuery({
    queryKey: ['versions', pid],
    queryFn: async () => (await api.get<VersionDTO[]>(`/projects/${pid}/versions`)).data,
    enabled: !!pid,
  });
export const useVersionContent = (vid?: string) =>
  useQuery({
    queryKey: ['version-content', vid],
    queryFn: async () =>
      (await api.get<{ content: string; fileName: string | null }>(`/versions/${vid}/content`)).data,
    enabled: !!vid,
    staleTime: Infinity,
  });
export const useProjectAnalyses = (pid?: string) =>
  useQuery({
    queryKey: ['project-analyses', pid],
    queryFn: async () =>
      (await api.get<AnalysisSummaryDTO[], PageMeta>(`/projects/${pid}/analyses?pageSize=50`)).data,
    enabled: !!pid,
  });
export const useConsumers = (pid?: string) =>
  useQuery({
    queryKey: ['consumers', pid],
    queryFn: async () => (await api.get<ConsumerDTO[]>(`/projects/${pid}/consumers`)).data,
    enabled: !!pid,
  });
export const useEntities = (pid?: string) =>
  useQuery({
    queryKey: ['entities', pid],
    queryFn: async () =>
      (await api.get<Array<{ key: string; label: string; kind: string }>>(`/projects/${pid}/entities`)).data,
    enabled: !!pid,
  });
export const usePolicy = (pid?: string) =>
  useQuery({
    queryKey: ['policy', pid],
    queryFn: async () =>
      (await api.get<{ current: PolicyDTO; history: PolicyDTO[] }>(`/projects/${pid}/policy`)).data,
    enabled: !!pid,
  });

/* ----------------------------------------------------------- analyses */
export const useAnalysis = (scope: AnalysisScope, id?: string) =>
  useQuery({
    queryKey: ['analysis', scope, id],
    queryFn: async () => (await api.get<AnalysisDTO>(analysisBase(scope, id!))).data,
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data && (q.state.data.state === 'queued' || q.state.data.state === 'running') ? 600 : false,
  });

export interface FindingFilters {
  severity: FindingSeverity[];
  ruleId?: string;
  search?: string;
  entity?: string;
  page: number;
  pageSize: number;
}
export interface FindingsMeta extends PageMeta {
  facets: {
    severity: Partial<Record<FindingSeverity, number>>;
    rules: Array<{ ruleId: string; count: number }>;
  };
}
export const useFindings = (
  scope: AnalysisScope,
  id: string | undefined,
  f: FindingFilters,
  enabled = true,
) =>
  useQuery({
    queryKey: ['findings', scope, id, f],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize) });
      for (const s of f.severity) qs.append('severity', s);
      if (f.ruleId) qs.set('ruleId', f.ruleId);
      if (f.search) qs.set('search', f.search);
      if (f.entity) qs.set('entity', f.entity);
      return api.get<FindingDTO[], FindingsMeta>(`${analysisBase(scope, id!)}/findings?${qs.toString()}`);
    },
    enabled: !!id && enabled,
    placeholderData: keepPreviousData,
  });
export const useImpact = (scope: AnalysisScope, id?: string, enabled = true) =>
  useQuery({
    queryKey: ['impact', scope, id],
    queryFn: async () => (await api.get<ImpactDTO>(`${analysisBase(scope, id!)}/impact`)).data,
    enabled: !!id && enabled,
  });
export const useSources = (scope: AnalysisScope, id?: string, enabled = true) =>
  useQuery({
    queryKey: ['sources', scope, id],
    queryFn: async () =>
      (
        await api.get<{
          baseline: { label: string; fileName: string | null; content: string; versionId: string };
          candidate: { label: string; fileName: string | null; content: string; versionId: string };
        }>(`${analysisBase(scope, id!)}/sources`)
      ).data,
    enabled: !!id && enabled,
    staleTime: Infinity,
  });
export const useReviews = (scope: AnalysisScope, id?: string) =>
  useQuery({
    queryKey: ['reviews', scope, id],
    queryFn: async () => (await api.get<ReviewDTO[]>(`${analysisBase(scope, id!)}/reviews`)).data,
    enabled: !!id,
  });
export const useDemoAnalyses = () =>
  useQuery({
    queryKey: ['demo-analyses'],
    queryFn: async () =>
      (await api.get<Array<AnalysisSummaryDTO & { description: string }>>('/demo/analyses')).data,
    staleTime: 60_000,
  });

/* ----------------------------------------------------------- notifications */
export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: async () => api.get<NotificationDTO[], { unread: number }>('/notifications'),
    enabled,
    refetchInterval: 30_000,
  });

/* ----------------------------------------------------------- mutations */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: unknown[][]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export const useCreateProject = (wid?: string) => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (b: { name: string; description: string; protocol: Protocol }) =>
      (await api.post<ProjectDTO>(`/workspaces/${wid}/projects`, b)).data,
    onSuccess: () => inv(['projects', wid], ['overview', wid], ['workspaces']),
  });
};

export const useUploadVersion = (pid?: string) => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (b: {
      label: string;
      content?: string;
      file?: File;
      fileName?: string;
      protocol?: Protocol;
      notes?: string;
    }) => {
      if (b.file) {
        const fd = new FormData();
        fd.append('label', b.label);
        if (b.protocol) fd.append('protocol', b.protocol);
        if (b.notes) fd.append('notes', b.notes);
        fd.append('file', b.file, b.file.name);
        return (await api.post<VersionDTO>(`/projects/${pid}/versions`, fd)).data;
      }
      return (
        await api.post<VersionDTO>(`/projects/${pid}/versions`, {
          label: b.label,
          content: b.content,
          fileName: b.fileName,
          protocol: b.protocol,
          notes: b.notes,
        })
      ).data;
    },
    onSuccess: () => inv(['versions', pid], ['project', pid], ['entities', pid]),
  });
};

export const useCreateAnalysis = (pid?: string) => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (b: { baselineId: string; candidateId: string; options: AnalysisOptions }) =>
      (await api.post<AnalysisDTO>(`/projects/${pid}/analyses`, b)).data,
    onSuccess: () => inv(['project-analyses', pid], ['project', pid]),
  });
};

export const useUpdatePolicy = (pid?: string) => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (b: UpdatePolicyInput) => (await api.put<PolicyDTO>(`/projects/${pid}/policy`, b)).data,
    onSuccess: () => inv(['policy', pid]),
  });
};

export type { UserDTO };
