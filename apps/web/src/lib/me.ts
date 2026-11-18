import { useQuery } from '@tanstack/react-query';
import { get, type Me } from './api.ts';

/** Current user, permissions and organization settings — the UI shows or hides actions from this payload. */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), staleTime: 60_000, retry: false });
