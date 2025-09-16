<?php

/**
 * @return array{
 *  'literal-string-key': string,
 *  1: int,
 *  -2: int,
 *  +4: int,
 *  unquoted-key: string,
 *  list: list<int>,
 *  int: int,
 *  float?: float,
 * }
 */
function example(): array
{
    return [
        'literal-string-key' => 'value',
        1 => 42,
        -2 => -42,
        +4 => 84,
        'unquoted-key' => 'value',
        'list' => [1, 2, 3],
        'int' => 100,
    ]; // no `float` key as it is optional
}
