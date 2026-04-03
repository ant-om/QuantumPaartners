"""
Write a function called 'main' that accepts a list of strings.

Your function should return a list with all the strings that are longer 
than 4, but shorter than or equal to 6 characters.
Keep the original ordering.

For example:
If we are calling your function as:
main(['Loqay', 'pHjQnh', 'rkE', 'PHOrlD', 'JeOlXwkK', 'Q', '']) 
then it should return the list: 
['Loqay', 'pHjQnh', 'PHOrlD']
"""

def main(l1):
    r1 = [x for x in l1 if 4<len(x)<=6]
    return r1

