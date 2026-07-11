"""
Write a function called 'main' that accepts one list consisting of values
of any type.

Your function should return a dictionary that has as keys the integers from 
the input list. The values are should be equal to the corresponding keys 
multiplied by 5.
Ignore other types of elements from the input list.

For example:
If we are calling your function as:
main(['j', 3, 9.55, False, 4.78, 6.37, 9.55, 'V', 'k', 7.96, 9.55, 2, 12.74, 0.0]) 
then it should return the dictionary: 
{3: 15, 2: 10}
"""
def main(l1):
    r1 = {k:k*5 for k in l1 if type(k)==int}
    return r1

