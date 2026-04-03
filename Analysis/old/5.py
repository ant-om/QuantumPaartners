"""
Write a function called 'main' that accepts a list of integers. 

Your function should return another list of integers, where the elements are
the corresponding items from the input list divided by their indexes plus 6,
using the integer division operator.

Hint: think about the input arguments of the enumerate() function.

For example:
If we are calling your function as:
main([46, 48, 26, 92, 59, 39, 27, 71, 58, 26]) 
then it should return the list: 
[7, 6, 3, 10, 5, 3, 2, 5, 4, 1]
"""
def main(l1):
    r1 = [x//(i + 6) for i,x in enumerate(l1)]
    return r1

