"""
Write a function called 'main' that accepts a list consisting of values of
any type.

Your function should return a tuple with all the float values multiplied by 
3. Ignore all other elements.

For example:
If we are calling your function as:
main([6.37, 'M', 9, 'J', 'B', 6.37, 1, 'W', 0.0, 'A', 4, 'A', False, 9]) 
then it should return the tuple: 
(19.11, 19.11, 0.0)
"""
def main(l1):
    r1 = tuple([x*3 for x in l1 if type(x)==float])
    return r1
