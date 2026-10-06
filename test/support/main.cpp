// The process entry for a test program: the compiler emits the program as
// `__gea_top_level`, and a test binary has nothing else to do but run it.
#include <cstdio>

void __gea_top_level();

int main() {
  __gea_top_level();
  std::fflush(stdout);
  return 0;
}
