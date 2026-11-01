#include "PcmThreadBridge.h"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>

typedef struct {
  pthread_mutex_t mutex;
  pthread_cond_t condition;
  int started;
  int mayExit;
  int joined;
} State;

static void worker(void *raw) {
  State *state = raw;
  pthread_mutex_lock(&state->mutex);
  state->started = 1;
  pthread_cond_broadcast(&state->condition);
  while (!state->mayExit) pthread_cond_wait(&state->condition, &state->mutex);
  pthread_mutex_unlock(&state->mutex);
}

typedef struct { PcmThread *thread; State *state; } JoinContext;
static void *joiner(void *raw) {
  JoinContext *context = raw;
  assert(pcm_thread_join(context->thread) == 0);
  pthread_mutex_lock(&context->state->mutex);
  context->state->joined = 1;
  pthread_cond_broadcast(&context->state->condition);
  pthread_mutex_unlock(&context->state->mutex);
  return NULL;
}

int main(void) {
  State state = {PTHREAD_MUTEX_INITIALIZER, PTHREAD_COND_INITIALIZER, 0, 0, 0};
  int error = 0;
  PcmThread *thread = pcm_thread_start(worker, &state, &error);
  assert(thread != NULL && error == 0 && !pcm_thread_is_current(thread));
  JoinContext context = {thread, &state};
  pthread_t joinThread;
  assert(pthread_create(&joinThread, NULL, joiner, &context) == 0);
  pthread_mutex_lock(&state.mutex);
  while (!state.started) pthread_cond_wait(&state.condition, &state.mutex);
  assert(!state.joined);
  state.mayExit = 1;
  pthread_cond_broadcast(&state.condition);
  while (!state.joined) pthread_cond_wait(&state.condition, &state.mutex);
  pthread_mutex_unlock(&state.mutex);
  assert(pthread_join(joinThread, NULL) == 0);
  pthread_cond_destroy(&state.condition);
  pthread_mutex_destroy(&state.mutex);
  puts("PCM pthread bridge test passed");
  return 0;
}
