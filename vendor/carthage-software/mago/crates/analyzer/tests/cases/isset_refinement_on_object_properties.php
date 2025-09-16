<?php

class X
{
    public null|string $a = null;
    public null|string $b = null;
}

function y(string $v): void
{
    echo "Value: $v\n";
}

function example_1(null|X $x = null): void
{
    if (!isset($x)) {
        return;
    }

    if (!isset($x->a)) {
        return;
    }

    if (!isset($x->b)) {
        return;
    }

    y($x->a);
    y($x->b);
}

function example_2(null|X $x = null): void
{
    if (!isset($x)) {
        return;
    }

    if (!isset($x->a) || !isset($x->b)) {
        return;
    }

    y($x->a);
    y($x->b);
}

function example_3(null|X $x = null): void
{
    if (!isset($x) || !isset($x->a) || !isset($x->b)) {
        return;
    }

    y($x->a);
    y($x->b);
}

function example_4(null|X $x = null): void
{
    if (isset($x, $x->a, $x->b)) {
        y($x->a);
        y($x->b);
    }
}

function example_5(null|X $x = null): void
{
    if (isset($x->a, $x->b)) {
        y($x->a);
        y($x->b);
    }
}

function example_6(mixed $v): void
{
    if ($v instanceof X) {
        example_1($v);
        example_2($v);
        example_3($v);
        example_4($v);
        example_5($v);
    }
}

if (isset($x, $x->a, $x->b)) {
    example_6($x);
    example_6($x->a);
    example_6($x->b);
}
