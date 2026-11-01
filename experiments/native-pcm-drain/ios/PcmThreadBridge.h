#ifndef NOTED_PCM_THREAD_BRIDGE_H
#define NOTED_PCM_THREAD_BRIDGE_H

typedef struct PcmThread PcmThread;
typedef void (*PcmThreadWork)(void *context);

PcmThread *pcm_thread_start(PcmThreadWork work, void *context, int *error);
int pcm_thread_join(PcmThread *thread);
int pcm_thread_is_current(PcmThread *thread);

#endif
