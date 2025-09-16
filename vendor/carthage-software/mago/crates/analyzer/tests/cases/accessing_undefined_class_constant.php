<?php

class A
{
}

/**
 * @mago-expect analysis:non-existent-class-constant
 * @mago-expect analysis:impossible-assignment
 */
function main()
{
    $_ = A::Foo;
}
