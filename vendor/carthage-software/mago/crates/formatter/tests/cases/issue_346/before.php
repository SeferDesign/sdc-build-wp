<?php

class A
{
    public function e()
    {
        if (true) {
            $event->getForm()->addError(
                new FormError(
                    'very_long_error_message',
                    'very_long_error_message',
                    ['{{ variable }}' => $var . 'toto', '{{ limit }}' => round($this->veryLongVarName / 1_000_000) . 'M']
                )
            );
        }
    }
}
