#include "PcmThreadBridge.h"
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>

struct PcmThread {
  pthread_t id;
  PcmThreadWork work;
  void *context;
};

static void *pcm_run(void *raw) {
  PcmThread *thread = raw;
  thread->work(thread->context);
  return NULL;
}

PcmThread *pcm_thread_start(PcmThreadWork work, void *context, int *error) {
  PcmThread *thread = malloc(sizeof(*thread));
  if (thread == NULL) { *error = ENOMEM; return NULL; }
  thread->work = work;
  thread->context = context;
  int result = pthread_create(&thread->id, NULL, pcm_run, thread);
  if (result != 0) { free(thread); *error = result; return NULL; }
  *error = 0;
  return thread;
}

int pcm_thread_join(PcmThread *thread) {
  int result = pthread_join(thread->id, NULL);
  if (result == 0) free(thread);
  return result;
}

int pcm_thread_is_current(PcmThread *thread) {
  return pthread_equal(pthread_self(), thread->id);
}
