<?php

namespace Psl\Type {
    /**
     * @template T
     */
    interface TypeInterface
    {
        /**
         * @param mixed $value
         *
         * @return T
         */
        public function assert($value): mixed;
    }

    /**
     * @template Tk of array-key
     * @template Tv
     *
     * @param array<Tk, TypeInterface<Tv>> $elements
     *
     * @return TypeInterface<array<Tk, Tv>>
     */
    function shape(array $elements, bool $allow_unknown_fields = false): TypeInterface
    {
        return shape($elements, $allow_unknown_fields);
    }

    /**
     * @return TypeInterface<string>
     */
    function string(): TypeInterface
    {
        return string();
    }

    /**
     * @return TypeInterface<int>
     */
    function int(): TypeInterface
    {
        return int();
    }

    /**
     * @template T
     * @param class-string<T> $class_name
     * @return TypeInterface<T>
     */
    function instance_of(string $class_name): TypeInterface
    {
        return instance_of($class_name);
    }
}

namespace {
    enum Example
    {
        case Foo;
        case Bar;
    }

    function get_mixed(): mixed
    {
        return 1;
    }

    function i_take_string(string $value): void
    {
        echo "Received string: $value\n";
    }

    function i_take_int(int $value): void
    {
        echo "Received int: $value\n";
    }

    function i_take_enum(Example $value): void
    {
        echo
            match ($value) {
                Example::Foo => "Received enum: Foo\n",
                Example::Bar => "Received enum: Bar\n",
            }
        ;
    }

    $array_type = Psl\Type\shape([
        'name' => Psl\Type\string(),
        'age' => Psl\Type\int(),
        'address' => Psl\Type\shape([
            'street' => Psl\Type\string(),
            'city' => Psl\Type\string(),
        ]),
    ]);

    $list_type = Psl\Type\shape([
        Psl\Type\string(),
        Psl\Type\int(),
        Psl\Type\shape([
            'street' => Psl\Type\string(),
            'city' => Psl\Type\string(),
        ]),
    ]);

    $enum_type = Psl\Type\instance_of(Example::class);

    $array = $array_type->assert(get_mixed());
    $list = $list_type->assert(get_mixed());
    $enum = $enum_type->assert(get_mixed());

    i_take_string($array['name']);
    i_take_int($array['age']);
    i_take_string($array['address']['street']);
    i_take_string($array['address']['city']);

    i_take_string($list[0]);
    i_take_int($list[1]);
    i_take_string($list[2]['street']);
    i_take_string($list[2]['city']);

    i_take_enum($enum);
}
