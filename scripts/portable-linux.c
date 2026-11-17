#define _GNU_SOURCE
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include "portable.h"

int main(int argc, char **argv) {
    char *self = realpath("/proc/self/exe", NULL);
    char **args = calloc((size_t)argc + 7, sizeof(*args));
    if (!self || !args) {
        perror("NHMCL");
        return 1;
    }
    args[0] = "/bin/bash";
    args[1] = "-c";
    args[2] = (char *)startup;
    args[3] = self;
    args[4] = PAYLOAD_SIZE;
    args[5] = PAYLOAD_SHA256;
    memcpy(args + 6, argv + 1, (size_t)argc * sizeof(*args));
    execv(args[0], args);
    perror("NHMCL");
    return 1;
}
