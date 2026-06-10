import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';

export interface PersonaResult {
  content: string;
  updated_at: string | null;
}

export function usePersona() {
  return useQuery({
    queryKey: ['persona'],
    queryFn: () => ops<PersonaResult>('persona:get', {}),
  });
}

export function useSetPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => ops('persona:set', { content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persona'] }),
  });
}
