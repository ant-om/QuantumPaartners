"""
Hugo explained in one of his videos for this week how iterators work. He 
explained how to create them and how to use them.

Assume you have to write a function that accepts a list with integers.

The following function achieves a goal by explicitly using an iterator. 
Examine it carefully:

def main(list_in):
    iterator = iter(list_in)
    list_out = []
    while True:
        try:   
            list_out.append(next(iterator) * 4)
        except StopIteration:
            break
    return list_out         

In this exercise, we'd like you to completely rewrite the 'main' function above 
by omitting the iterator and using either a for-loop or a list comprehension 
instead.

Your own function should also be called 'main' and should achieve the same
goal as the one above.
"""
def main(l1):
    return [x*4 for x in l1]



