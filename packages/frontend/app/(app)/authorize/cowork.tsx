import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function AuthorizeCoworkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // Redirect to unified authorize screen with app=cowork
    router.replace({ pathname: '/authorize', params: { ...params, app: 'cowork' } });
  }, [params, router]);

  return null;
}
