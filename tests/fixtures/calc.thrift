namespace js calc

struct Sum {
  1: i32 a,
  2: i32 b,
  3: i32 total
}

service Calculator {
  Sum add(1: i32 a, 2: i32 b)
}
