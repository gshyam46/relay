import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { Organization } from "@/types";

export interface AuthUser {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthResponse {
  user: AuthUser;
  organization: Organization;
}

// The session cookie (not this query) is the real source of truth for "am I logged in" — this
// just asks the server what it thinks that cookie means. A failed request (401, or no cookie at
// all) means "not signed in", not an error to retry.
export function useMe() {
  const setCurrentOrg = useWorkspaceStore((s) => s.setCurrentOrg);
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthResponse>("/auth/me"),
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setCurrentOrg(query.data.organization);
    }
  }, [query.data, setCurrentOrg]);

  return query;
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { organization_name: string; name: string; email: string; password: string }) =>
      api.post<AuthResponse>("/auth/register", input),
    onSuccess: (data) => {
      qc.setQueryData(["auth", "me"], data);
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<AuthResponse>("/auth/login", input),
    onSuccess: (data) => {
      qc.setQueryData(["auth", "me"], data);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const setCurrentOrg = useWorkspaceStore((s) => s.setCurrentOrg);
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      setCurrentOrg(null);
      qc.setQueryData(["auth", "me"], null);
      qc.clear();
    },
  });
}
